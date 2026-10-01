module.exports = async () => {
  await globalThis.__HERMETIC_PG__?.stop();
};
