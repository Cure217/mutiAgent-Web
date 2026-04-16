const fs = require('node:fs');
const path = require('node:path');

const localElectronDist = path.resolve(__dirname, 'node_modules', 'electron', 'dist');
const useLocalElectronDist = fs.existsSync(path.join(localElectronDist, 'electron.exe'));
const desktopBundleDir = path.resolve(__dirname, '.desktop-bundle');
const desktopAppIconIco = path.resolve(__dirname, 'electron', 'assets', 'app-icon.ico');
const desktopAppIconPng = path.resolve(__dirname, 'electron', 'assets', 'app-icon.png');
const desktopAppIcon = fs.existsSync(desktopAppIconIco)
  ? desktopAppIconIco
  : (fs.existsSync(desktopAppIconPng) ? desktopAppIconPng : undefined);
const extraResources = [];

if (fs.existsSync(path.join(desktopBundleDir, 'backend', 'mutiAgent.jar'))) {
  extraResources.push({
    from: path.join(desktopBundleDir, 'backend'),
    to: 'backend',
    filter: ['**/*']
  });
}

if (fs.existsSync(path.join(desktopBundleDir, 'java-runtime', 'bin', 'java.exe'))) {
  extraResources.push({
    from: path.join(desktopBundleDir, 'java-runtime'),
    to: 'java-runtime',
    filter: ['**/*']
  });
}

/**
 * @type {import('electron-builder').Configuration}
 */
module.exports = {
  appId: 'com.aliano.mutiagent.console',
  productName: 'mutiAgent',
  executableName: 'mutiAgent',
  icon: desktopAppIcon,
  electronDist: useLocalElectronDist ? localElectronDist : undefined,
  directories: {
    output: 'make'
  },
  extraResources,
  files: [
    {
      from: 'dist',
      to: 'dist',
      filter: ['**/*']
    },
    {
      from: 'electron',
      to: 'electron',
      filter: ['**/*']
    },
    {
      from: '.',
      to: '.',
      filter: ['package.json']
    }
  ],
  win: {
    icon: desktopAppIcon,
    signAndEditExecutable: false,
    target: [
      {
        target: 'dir',
        arch: ['x64']
      }
    ]
  }
};
