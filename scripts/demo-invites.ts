// TL-18: create a fresh set of single-use demo invites and print where each one goes.
// Owner only. Codes are printed to this terminal and never written to a file.
//   npm run demo:invites
//   SPACETIMEDB_SERVER=maincloud SPACETIMEDB_DB_NAME=time-left-hackutd26 npm run demo:invites
import { DB, SERVER, createInvite } from './lib';

const LEAD = 'tornado-1'; // displayed as the winter freeze
const SECOND = 'freeze-1'; // displayed as the tornado

const invites: [role: string, incident: string, subject: string, where: string][] = [
  ['coordinator', LEAD, '', 'D: lead board window (Winter freeze): Connection check, Claim role'],
  ['coordinator', SECOND, '', 'D: second browser profile, second board (Tornado)'],
  ['driver', LEAD, 'ana', 'D: driver phone window for Ana'],
  ['driver', LEAD, 'ben', 'D: driver phone window for Ben (H22 / race)'],
  ['resident', LEAD, 'H17', 'D: resident phone + registration window for H17'],
  ['resident', LEAD, 'H22', 'D: resident window for H22 (silent household)'],
  ['bridge', LEAD, '', 'B: backend/bridge/.env BRIDGE_INVITE_CODE= (only if the bridge has no saved .stdb-token)'],
];

try {
  console.log(`New invites on ${SERVER}/${DB}. Each works once; send each one privately.\n`);
  for (const [role, incident, subject, where] of invites) {
    const code = createInvite(role, incident, subject);
    console.log(`${`${role}${subject ? ` ${subject}` : ''} (${incident})`.padEnd(28)} ${code}\n    -> ${where}`);
  }
} catch (err) {
  console.error(`FAIL: ${(err as Error).message}`);
  process.exit(1);
}
