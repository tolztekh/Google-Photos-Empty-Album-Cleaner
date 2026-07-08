declare module "webextension-polyfill" {
  const browser: typeof chrome;
  export default browser;
}
