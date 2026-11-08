// TL-09 acceptance check (A side): preparedness enrollment and voluntary agent contact.
// Opt-in creates one lead even on retry, Skip creates none, the request is offered only after
// delivery, opt-ins are counted apart from registrations, and consent never reaches dispatch.
// Run against a freshly reset database: npm run stdb:reset:local && npm run check:tl09
import { tables } from '../src/module_bindings';
import { connect, connectAs, fail, finish, ownerSqlCount, rejects, run, sleep, waitFor } from './lib';

const INCIDENT = 'tornado-1';

run(async () => {
  const mine = [tables.myRole, tables.myProfile, tables.myAgentRequest, tables.residentJobs];
  const coord = await connectAs('coordinator', 'coordinator', INCIDENT, '', [
    tables.myIncident, tables.coordinatorHouseholds, tables.coordinatorJobs,
    tables.coordinatorProfiles, tables.coordinatorRegistryStats,
  ]);
  const bridge = await connectAs('bridge', 'bridge', INCIDENT, '', [tables.myRole]);
  const ana = await connectAs('driver Ana', 'driver', INCIDENT, 'ana', [tables.driverJobs, tables.coordinatorProfiles]);
  const h17 = await connectAs('resident H17', 'resident', INCIDENT, 'H17', mine);
  const h22 = await connectAs('resident H22', 'resident', INCIDENT, 'H22', mine);
  const outsider = await connect('outsider', [...mine, tables.coordinatorProfiles, tables.coordinatorRegistryStats]);

  const stats = () => [...coord.db.coordinatorRegistryStats.iter()][0];
  await waitFor('coordinator stats', () => stats() !== undefined);
  if (stats().registrations !== 0 || coord.db.coordinatorJobs.count() !== 0n) fail('reset first (npm run stdb:reset:local)');

  // 1. Before the incident: free preparedness profiles. Synthetic details only.
  const h17Profile = {
    enrollmentId: 'tl09-h17-enroll', medicalNeed: 'home_oxygen',
    backupDevice: 'oxygen concentrator battery', address: '100 Example Lane (synthetic)', preferredContact: 'imessage',
  };
  await h17.reducers.enrollPreparedness(h17Profile);
  await h17.reducers.enrollPreparedness(h17Profile); // retry
  const badNeed = await rejects('bad need', () =>
    h22.reducers.enrollPreparedness({ ...h17Profile, enrollmentId: 'tl09-bad', medicalNeed: 'pizza' }), /unknown medicalNeed/);
  await h22.reducers.enrollPreparedness({
    enrollmentId: 'tl09-h22-enroll', medicalNeed: 'no_heat',
    backupDevice: 'none', address: '200 Example Lane (synthetic)', preferredContact: 'phone_call',
  });
  await waitFor('two registrations', () => stats().registrations === 2);
  const p = [...h17.db.myProfile.iter()][0];
  console.log(`H17 enrolled: ${p.medicalNeed}, ${p.backupDevice}, contact ${p.preferredContact}; retry added nothing`);
  console.log(`coordinator sees ${coord.db.coordinatorProfiles.count()} profiles; stats: ${stats().registrations} registrations, ${stats().agentOptIns} opt-ins`);

  const twice = await rejects('second profile', () =>
    h17.reducers.enrollPreparedness({ ...h17Profile, enrollmentId: 'tl09-h17-again' }), /conflict: H17 already has/);
  const notResident = await rejects('outsider enroll', () =>
    outsider.reducers.enrollPreparedness({ ...h17Profile, enrollmentId: 'tl09-x' }), /forbidden/);
  console.log(`rejected: ${twice} | ${badNeed} | ${notResident}`);

  // 2. The agent request is offered only after delivery.
  const early = await rejects('consent before delivery', () =>
    h17.reducers.requestAgentContact({ consentId: 'tl09-h17-consent' }), /only after help is delivered/);
  console.log(`before delivery: ${early}`);

  // 3. Deliver help to H17 through TL-05/TL-06 (consent plays no part in any of it).
  const incident = [...coord.db.myIncident.iter()][0];
  await bridge.reducers.ingestCheckin({
    eventId: 'tl09-h17-0200', incidentId: INCIDENT, householdId: 'H17', observedAt: incident.clockAt,
    text: 'My oxygen concentrator battery shows 30-60 minutes left.', runtimeLowerMin: 30, runtimeUpperMin: 60,
  });
  await waitFor('H17 v1', () => [...coord.db.coordinatorHouseholds.iter()].some(h => h.id === 'H17' && h.version === 1));
  await coord.reducers.reserve({
    jobRequestId: 'tl09-h17-job', caseId: 'H17', routeId: 'R4-ALT', assetId: 'BAT-01', driverId: 'ana', expectedVersion: 1,
  });
  await waitFor('Ana has the job', () => ana.db.driverJobs.count() === 1n);
  const jobId = [...ana.db.driverJobs.iter()][0].id;
  await ana.reducers.updateJob({ jobId, expectedVersion: 1, status: 'arrived' });
  await waitFor('H17 sees arrived', () => [...h17.db.residentJobs.iter()][0]?.status === 'arrived');
  await h17.reducers.updateJob({ jobId, expectedVersion: 2, status: 'delivered' });
  await waitFor('H17 sees delivered', () => [...h17.db.residentJobs.iter()][0]?.status === 'delivered');
  console.log(`job #${jobId} delivered to H17 (Ana, R4-ALT)`);

  // 4. Opt-in creates one lead, even on retry. A second consent ID is a conflict.
  await h17.reducers.requestAgentContact({ consentId: 'tl09-h17-consent' });
  await h17.reducers.requestAgentContact({ consentId: 'tl09-h17-consent' }); // retry
  await waitFor('H17 receipt', () => h17.db.myAgentRequest.count() === 1n);
  const lead = [...h17.db.myAgentRequest.iter()][0];
  const again = await rejects('second consent', () =>
    h17.reducers.requestAgentContact({ consentId: 'tl09-h17-other' }), /conflict: H17 already has request L-/);
  await waitFor('one opt-in counted', () => stats().agentOptIns === 1);
  await sleep(300);
  if (ownerSqlCount('SELECT id FROM agent_contact') !== 1) fail('expected exactly one lead row');
  console.log(`H17 opts in: receipt L-${lead.id}, contact ${lead.preferredContact}, job #${lead.jobId}; retry added nothing`);
  console.log(`second consent ID: ${again}`);

  // 5. Skip creates none: H22 never calls requestAgentContact.
  if (h22.db.myAgentRequest.count() !== 0n) fail('H22 has a lead without consenting');
  console.log(`H22 skips: no lead; stats: ${stats().registrations} registrations, ${stats().agentOptIns} opt-in`);

  // 6. Privacy and equal access.
  const leaks =
    h22.db.myProfile.count() !== 1n ||
    [...h22.db.myProfile.iter()][0].householdId !== 'H22' ||
    outsider.db.myProfile.count() + outsider.db.myAgentRequest.count() + outsider.db.coordinatorProfiles.count() !== 0n ||
    outsider.db.coordinatorRegistryStats.count() !== 0n ||
    ana.db.coordinatorProfiles.count() !== 0n;
  if (leaks) fail('profiles or leads are visible outside their household or role');
  const keys = (id: string) => Object.keys([...coord.db.coordinatorHouseholds.iter()].find(h => h.id === id)!).sort().join();
  if (keys('H17') !== keys('H22') || /consent|agent|lead|profile/i.test(keys('H17'))) {
    fail('household rows carry consent state');
  }
  console.log('privacy: each resident sees only their own profile; driver and outsider see none; coordinators see counts, not leads');
  console.log('equal access: household rows used for dispatch carry no consent or profile fields');

  console.log('PASS: TL-09 enrollment and agent contact');
  finish(0);
});
