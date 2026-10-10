const path = require('node:path');
const { mkdirSync } = require('node:fs');

const APP_NAME = 'dots';
const APP_VERSION = require('../package.json').version;
const ICON_PATH = path.resolve(__dirname, '../public/dots.png');
function configureApplicationName(app) {
  const paths = ['userData', 'sessionData', 'logs'].map(name => [name, app.getPath(name)]);
  for (const [name, value] of paths) { mkdirSync(value, { recursive: true }); app.setPath(name, value); }
  app.setName(APP_NAME);
}
function configureApplicationBranding(app, nativeImage, platform = process.platform) {
  const icon = nativeImage.createFromPath(ICON_PATH);
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: APP_VERSION,
    copyright: '界面基于 BB，MIT © 2026 Michael Yong；App icon: Ghost / ipaslogo.com',
    ...(platform === 'darwin' ? { version: APP_VERSION } : { iconPath: ICON_PATH }),
  });
  if (platform === 'darwin' && app.dock && !icon.isEmpty()) app.dock.setIcon(icon);
  return icon;
}
module.exports = { APP_NAME, APP_VERSION, ICON_PATH, configureApplicationName, configureApplicationBranding };
