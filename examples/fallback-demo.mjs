import { createState, select, failure, success } from '../src/policy.mjs';

const models = ['mock/preferred', 'mock/local'];
let state = createState('demo-session');
const responses = { 'mock/preferred': 429, 'mock/local': 200 };
for (;;) {
  const choice = select(state, models, { now: 0 });
  state = choice.state;
  if (choice.action !== 'dispatch') {
    console.log(JSON.stringify({ action: choice.action, reason: choice.reason }));
    break;
  }
  console.log(JSON.stringify({ sessionId: state.sessionId, model: choice.model, status: responses[choice.model] }));
  if (responses[choice.model] === 200) {
    state = success(state, choice);
    break;
  }
  const result = failure(state, choice, {
    status: responses[choice.model], responseStarted: false, effects: 'none',
  }, { now: 0 });
  state = result.state;
  if (result.action === 'stop') break;
}
