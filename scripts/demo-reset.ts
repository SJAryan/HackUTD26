// TL-18: put demo incidents back to their seed, re-anchored to now, and set the follow-up
// interval. Owner only (runs through your CLI identity). Claimed roles survive.
//   npm run demo:reset                      # both incidents on local
//   npm run demo:reset -- tornado-1         # just the lead incident
//   SPACETIMEDB_SERVER=maincloud SPACETIMEDB_DB_NAME=time-left-hackutd26 DEMO_FOLLOWUP_SEC=60 npm run demo:reset
// Also starts the follow-up sweep if it is missing (e.g. after a publish that kept data).
import { DB, SERVER, ownerCall, ownerSqlCount } from './lib';

const incidents = process.argv.slice(2).length ? process.argv.slice(2) : ['tornado-1', 'freeze-1'];
const seconds = Number(process.env.DEMO_FOLLOWUP_SEC ?? 300);

try {
  for (const id of incidents) {
    ownerCall('reset_incident', id);
    const households = ownerSqlCount(`SELECT id FROM household WHERE incident_id = '${id}'`);
    console.log(`reset ${id} on ${SERVER}/${DB}: ${households} households back to the seed, clock = now`);
  }
  ownerCall('set_followup_interval', seconds);
  console.log(`follow-up interval ${seconds}s; sweep scheduled`);
  console.log(`roles kept: ${ownerSqlCount('SELECT identity FROM member')} members`);
} catch (err) {
  console.error(`FAIL: ${(err as Error).message}`);
  process.exit(1);
}
