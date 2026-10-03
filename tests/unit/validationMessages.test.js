// Validation messages are shown to users as-is (validate() joins them into
// the 422 error). Pins the ones that matter across zod upgrades: zod 4
// changed both its default wording and how custom "required" messages are
// declared.
const schemas = require('../../server/validators/schemas');

function messages(schema, input) {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('validation messages', () => {
  it('reports a missing field as "Required", whatever its type', () => {
    expect(messages(schemas.loginSchema, {})).toEqual(['Required', 'Required']);
    expect(messages(schemas.setStaffRoleSchema, {})).toEqual(['Required']);
  });

  it('keeps per-field messages for a missing password or withdrawal PIN', () => {
    expect(messages(schemas.changePasswordSchema, {})).toEqual(['Enter your current password', 'Enter a new password']);
    const withdrawal = { amount: 100, destination: { bankName: 'GTB', accountNumber: '0123456789', accountName: 'Ade' } };
    expect(messages(schemas.withdrawalSchema, withdrawal)).toEqual(['Enter your PIN to confirm this withdrawal']);
  });

  it('still rejects non-https links with the custom message', () => {
    const base = { fullName: 'Ade', phone: '08011111111', pin: '1234', businessLocation: 'Yaba' };
    expect(messages(schemas.registerBoardmanSchema, { ...base, kycDocumentUrl: 'http://example.com/id.png' })).toEqual([
      'Links must start with https://',
    ]);
  });
});
