// Manage login accounts. Passwords are stored only as salted hashes.
//
//   npm run user -- list
//   npm run user -- set <id> <password> [--name "Full Name"] [--role coordinator|volunteer]
//   npm run user -- remove <id>
//
// `set` creates the account, or changes the password (and name or role if given).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_PASSWORD, ROLE_ALIASES, hashPassword, readUsers } from './auth.js';

export const USERS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'users.json');

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
};
const positional = rest.filter((arg, i) => !arg.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const users = fs.existsSync(USERS_FILE) ? readUsers(USERS_FILE) : [];
const save = () => fs.writeFileSync(USERS_FILE, `${JSON.stringify(users, null, 2)}\n`);

if (command === 'list') {
  if (!users.length) console.log('No accounts yet.');
  for (const u of users) console.log(`${u.username.padEnd(16)} ${u.role.padEnd(20)} ${u.name}`);
} else if (command === 'set') {
  const [username, password] = positional;
  if (!username || !password) fail('Usage: npm run user -- set <id> <password> [--name "Full Name"] [--role coordinator|volunteer]');
  if (!/^[a-z0-9._-]{3,32}$/i.test(username)) fail('The ID must be 3 to 32 letters, numbers, dots, dashes or underscores.');
  if (password.length < MIN_PASSWORD) fail(`The password must be at least ${MIN_PASSWORD} characters.`);
  const roleArg = flag('role');
  const role = roleArg ? ROLE_ALIASES[roleArg.toLowerCase()] : undefined;
  if (roleArg && !role) fail('The role must be coordinator or volunteer.');
  const existing = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!existing && !role) fail('A new account needs --role coordinator or --role volunteer.');
  const { salt, hash } = await hashPassword(password);
  if (existing) Object.assign(existing, { role: role ?? existing.role, name: flag('name') ?? existing.name, salt, hash });
  else users.push({ username: username.toLowerCase(), name: flag('name') ?? username, role, salt, hash });
  save();
  console.log(`${existing ? 'Updated' : 'Created'} account "${username.toLowerCase()}".`);
} else if (command === 'remove') {
  const [username] = positional;
  const index = users.findIndex((u) => u.username.toLowerCase() === String(username).toLowerCase());
  if (index === -1) fail(`No account "${username}".`);
  users.splice(index, 1);
  save();
  console.log(`Removed "${username}".`);
} else {
  fail('Commands: list | set <id> <password> [--name "Full Name"] [--role coordinator|volunteer] | remove <id>');
}
