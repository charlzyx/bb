const path = require('node:path');
const { mkdirSync } = require('node:fs');

const APP_NAME = 'dots';
const ICON_PATH = path.resolve(__dirname, '../public/dots.png');
function configureApplicationName(app) {
  const paths = ['userData', 'sessionData', 'logs'].map(name => [name, app.getPath(name)]);
  for (const [name, value] of paths) { mkdirSync(value, { recursive: true }); app.setPath(name, value); }
  app.setName(APP_NAME);
}
function configureApplicationBranding(app, nativeImage, platform = process.platform) {
  const icon = nativeImage.createFromPath(ICON_PATH);
  app.setAboutPanelOptions({ applicationName: APP_NAME, copyright: '界面基于 BB，MIT © 2026 Michael Yong', iconPath: ICON_PATH });
  if (platform === 'darwin' && app.dock && !icon.isEmpty()) app.dock.setIcon(icon);
  return icon;
}
module.exports = { APP_NAME, ICON_PATH, configureApplicationName, configureApplicationBranding };
