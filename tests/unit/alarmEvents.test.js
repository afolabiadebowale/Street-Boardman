// Every CloudWatch alarm (infra/terraform/monitoring.tf) watches a log
// event by name. If the code stops emitting that name (a rename, a typo),
// the alarm goes silent without anyone noticing. This keeps the two in
// step (A4).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

function serverSource() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(path.join(root, 'server'));
  return files.join('\n');
}

describe('alarm log events', () => {
  const terraform = fs.readFileSync(path.join(root, 'infra', 'terraform', 'monitoring.tf'), 'utf8');
  const events = [...new Set([...terraform.matchAll(/\$\.event = \\"([a-z_]+)\\"/g)].map((m) => m[1]))];
  const source = serverSource();

  it('finds the alarms in monitoring.tf', () => {
    expect(events).toEqual(expect.arrayContaining(['payout_transfer_stuck', 'payout_float_low', 'notification_send_failed']));
  });

  it.each(events)('the server emits "%s"', (event) => {
    expect(source).toMatch(new RegExp(`event: '${event}'`));
  });
});
