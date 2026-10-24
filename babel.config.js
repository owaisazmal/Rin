// Metro applies babel-preset-expo itself; Jest needs it spelled out
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
