// Runs the app's actions on the API server, where each one is all or nothing
// and requests are handled one at a time. If the API has no /actions route
// (plain JSON Server), the same actions run in the browser instead.
import { ApiError } from '../api/client.js';
import { RuleError } from './actions.js';

export function createServerActions(api, local) {
  const remote = {};
  for (const name of Object.keys(local)) {
    remote[name] = async (...args) => {
      try {
        return await api.callAction(name, args);
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.rule) throw new RuleError(err.rule.message, err.rule.fields);
          if (err.status === 404 && !err.handled) return local[name](...args);
        }
        throw err;
      }
    };
  }
  return remote;
}
