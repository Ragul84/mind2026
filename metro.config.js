const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const exclusionList = require(path.join(__dirname, 'node_modules', 'metro-config', 'src', 'defaults', 'exclusionList')).default;

const config = getDefaultConfig(__dirname);
const { transformer, resolver } = config;

config.transformer = {
  ...transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer'),
};

const escapeForRegex = (value) => value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
const keptRoots = new Set([
  'app',
  'assets',
  'components',
  'constants',
  'hooks',
  'node_modules',
  'services',
  'theme',
  'utils',
]);

const topLevelIgnoredDirs = fs
  .readdirSync(__dirname, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !keptRoots.has(entry.name))
  .map((entry) => entry.name);

const ignorePaths = topLevelIgnoredDirs.map((relativePath) => {
  const absolutePath = path.join(__dirname, relativePath);
  return new RegExp(`${escapeForRegex(absolutePath)}(?:[/\\\\].*)?$`);
});

config.resolver = {
  ...resolver,
  assetExts: [
    ...resolver.assetExts.filter((ext) => ext !== 'svg'),
    'moc3',
    'model3',
    'physics3',
    'cdi3',
    'exp3',
  ],
  sourceExts: [...resolver.sourceExts, 'svg'],
  alias: {
    'react-native/Libraries/Utilities/LoadingView': require.resolve(
      'react-native/Libraries/Components/ActivityIndicator/ActivityIndicator',
    ),
  },
  blockList: exclusionList(ignorePaths),
  extraNodeModules: {},
};

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      if (req.url && req.url.includes('.bundle')) {
        res.setHeader('Content-Type', 'application/javascript');
      }
      return middleware(req, res, next);
    };
  },
};

module.exports = config;
