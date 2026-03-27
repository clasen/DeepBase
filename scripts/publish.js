#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// Console colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function exec(cmd, cwd = ROOT, silent = false) {
  try {
    const output = execSync(cmd, { 
      cwd, 
      encoding: 'utf-8',
      stdio: silent ? 'pipe' : 'inherit'
    });
    return output?.trim();
  } catch (error) {
    throw new Error(`Command failed: ${cmd}\n${error.message}`);
  }
}

// Define the correct publishing order
const PACKAGES = [
  { name: 'deepbase', path: 'packages/core' },
  { name: 'deepbase-json', path: 'packages/driver-json' },
  { name: 'deepbase-mongodb', path: 'packages/driver-mongodb' },
  { name: 'deepbase-redis', path: 'packages/driver-redis' },
  { name: 'deepbase-redis-json', path: 'packages/driver-redis-json' },
  { name: 'deepbase-sqlite', path: 'packages/driver-sqlite' },
  { name: 'deepbase-drizzle', path: 'packages/driver-drizzle' },
  { name: 'deepbase-indexeddb', path: 'packages/driver-indexeddb' },
];

function getPackageJson(pkgPath) {
  const fullPath = path.join(ROOT, pkgPath, 'package.json');
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
}

function savePackageJson(pkgPath, data) {
  const fullPath = path.join(ROOT, pkgPath, 'package.json');
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2) + '\n');
}

function getCurrentVersions() {
  const versions = {};
  for (const pkg of PACKAGES) {
    const packageJson = getPackageJson(pkg.path);
    versions[pkg.name] = packageJson.version;
  }
  return versions;
}

function incrementVersion(version, type = 'patch') {
  const [major, minor, patch] = version.split('.').map(Number);
  
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Invalid version type: ${type}`);
  }
}

function updateAllVersions(newVersion) {
  log('\n📝 Updating versions in package.json...', 'cyan');
  
  for (const pkg of PACKAGES) {
    const packageJson = getPackageJson(pkg.path);
    const oldVersion = packageJson.version;
    
    // Update package version
    packageJson.version = newVersion;
    
    // Update deepbase package dependencies
    if (packageJson.dependencies) {
      for (const depName of Object.keys(packageJson.dependencies)) {
        if (depName.startsWith('deepbase')) {
          packageJson.dependencies[depName] = `^${newVersion}`;
        }
      }
    }
    
    // Update peerDependencies
    if (packageJson.peerDependencies) {
      for (const depName of Object.keys(packageJson.peerDependencies)) {
        if (depName.startsWith('deepbase')) {
          packageJson.peerDependencies[depName] = `^${newVersion}`;
        }
      }
    }
    
    savePackageJson(pkg.path, packageJson);
    log(`  ✓ ${pkg.name}: ${oldVersion} → ${newVersion}`, 'green');
  }
  
  // Update monorepo root version
  const rootPackageJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')
  );
  rootPackageJson.version = newVersion;
  fs.writeFileSync(
    path.join(ROOT, 'package.json'),
    JSON.stringify(rootPackageJson, null, 2) + '\n'
  );
  log(`  ✓ monorepo root: ${newVersion}`, 'green');
}

function runTests() {
  log('\n🧪 Running tests...', 'cyan');
  
  for (const pkg of PACKAGES) {
    log(`\n  Testing ${pkg.name}...`, 'yellow');
    try {
      exec('npm test', path.join(ROOT, pkg.path), true);
      log(`  ✓ ${pkg.name} tests passed`, 'green');
    } catch (error) {
      log(`  ✗ ${pkg.name} tests failed`, 'red');
      throw error;
    }
  }
  
  log('\n✅ All tests passed!', 'green');
}

function publishPackages(dryRun = false) {
  log('\n📦 Publishing packages...', 'cyan');
  
  const publishCmd = dryRun 
    ? 'npm publish --dry-run --access public'
    : 'npm publish --access public';
  
  for (const pkg of PACKAGES) {
    log(`\n  Publishing ${pkg.name}...`, 'yellow');
    
    try {
      const pkgPath = path.join(ROOT, pkg.path);
      exec(publishCmd, pkgPath);
      log(`  ✓ ${pkg.name} published successfully`, 'green');
      
      // Wait a bit between publications to avoid registry issues
      if (!dryRun) {
        log('    Waiting 5 seconds...', 'blue');
        execSync('sleep 5');
      }
    } catch (error) {
      log(`  ✗ Error publishing ${pkg.name}`, 'red');
      throw error;
    }
  }
  
  log('\n✅ All packages published!', 'green');
}

function gitCommitAndTag(version) {
  log('\n📝 Creating commit and tag in git...', 'cyan');
  
  try {
    // Add all package.json changes
    exec('git add package.json packages/*/package.json');
    
    // Commit
    exec(`git commit -m "chore: release v${version}"`);
    log('  ✓ Commit created', 'green');
    
    // Create tag
    exec(`git tag -a v${version} -m "Release v${version}"`);
    log(`  ✓ Tag v${version} created`, 'green');
    
    log('\n💡 Don\'t forget to run: git push && git push --tags', 'yellow');
  } catch (error) {
    log('  ⚠️  Git error (might already be committed)', 'yellow');
  }
}

function showCurrentVersions() {
  const versions = getCurrentVersions();
  log('\n📋 Current versions:', 'cyan');
  for (const [name, version] of Object.entries(versions)) {
    log(`  ${name}: ${version}`, 'blue');
  }
  
  // Check if all versions are the same
  const uniqueVersions = [...new Set(Object.values(versions))];
  if (uniqueVersions.length > 1) {
    log('\n⚠️  WARNING: Versions are not synchronized!', 'yellow');
  }
  
  return uniqueVersions[0];
}

async function prompt(question) {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  log('═══════════════════════════════════════════════════════', 'bright');
  log('  🚀 DeepBase Publishing Tool', 'bright');
  log('═══════════════════════════════════════════════════════', 'bright');
  
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipTests = args.includes('--skip-tests');
  const skipGit = args.includes('--skip-git');
  
  if (dryRun) {
    log('\n🔍 DRY-RUN mode (will not actually publish)', 'yellow');
  }
  
  // Show current versions
  const currentVersion = showCurrentVersions();
  
  // Determine new version
  let newVersion;
  const versionArg = args.find(arg => !arg.startsWith('--'));
  
  if (versionArg) {
    // Version specified as argument
    if (['major', 'minor', 'patch'].includes(versionArg)) {
      newVersion = incrementVersion(currentVersion, versionArg);
      log(`\n📈 Incrementing version (${versionArg}): ${currentVersion} → ${newVersion}`, 'cyan');
    } else if (/^\d+\.\d+\.\d+$/.test(versionArg)) {
      newVersion = versionArg;
      log(`\n📌 Specified version: ${newVersion}`, 'cyan');
    } else {
      log(`\n❌ Invalid version: ${versionArg}`, 'red');
      log('Use: major, minor, patch, or X.Y.Z', 'yellow');
      process.exit(1);
    }
  } else {
    // Interactive mode
    log('\nWhat type of version do you want to publish?', 'cyan');
    log(`  1) patch  (${currentVersion} → ${incrementVersion(currentVersion, 'patch')})`, 'blue');
    log(`  2) minor  (${currentVersion} → ${incrementVersion(currentVersion, 'minor')})`, 'blue');
    log(`  3) major  (${currentVersion} → ${incrementVersion(currentVersion, 'major')})`, 'blue');
    log('  4) Specify manually', 'blue');
    
    const choice = await prompt('\nChoose an option (1-4): ');
    
    switch (choice) {
      case '1':
        newVersion = incrementVersion(currentVersion, 'patch');
        break;
      case '2':
        newVersion = incrementVersion(currentVersion, 'minor');
        break;
      case '3':
        newVersion = incrementVersion(currentVersion, 'major');
        break;
      case '4':
        newVersion = await prompt('Enter the new version (X.Y.Z): ');
        if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
          log('\n❌ Invalid version', 'red');
          process.exit(1);
        }
        break;
      default:
        log('\n❌ Invalid option', 'red');
        process.exit(1);
    }
    
    log(`\n📌 New version: ${newVersion}`, 'green');
    const confirm = await prompt('\nContinue? (y/n): ');
    if (confirm.toLowerCase() !== 'y') {
      log('\n❌ Cancelled', 'red');
      process.exit(0);
    }
  }
  
  try {
    // Update versions
    updateAllVersions(newVersion);
    
    // Run tests
    if (!skipTests) {
      runTests();
    } else {
      log('\n⚠️  Skipping tests (--skip-tests)', 'yellow');
    }
    
    // Publish packages
    publishPackages(dryRun);
    
    // Git commit and tag
    if (!dryRun && !skipGit) {
      gitCommitAndTag(newVersion);
    }
    
    log('\n═══════════════════════════════════════════════════════', 'bright');
    log('  ✅ Publishing completed successfully!', 'green');
    log('═══════════════════════════════════════════════════════', 'bright');
    
    if (!dryRun) {
      log('\n📝 Next steps:', 'cyan');
      log('  1. git push', 'blue');
      log('  2. git push --tags', 'blue');
      log('  3. Verify on npmjs.com that packages were published', 'blue');
    }
    
  } catch (error) {
    log('\n═══════════════════════════════════════════════════════', 'bright');
    log('  ❌ Error during publishing', 'red');
    log('═══════════════════════════════════════════════════════', 'bright');
    log(`\n${error.message}`, 'red');
    log('\n⚠️  Versions in package.json were updated.', 'yellow');
    log('You can revert with: git checkout -- package.json packages/*/package.json', 'yellow');
    process.exit(1);
  }
}

// Help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
🚀 DeepBase Publishing Tool

Usage:
  npm run publish [version] [options]

Versions:
  patch              Increment patch version (X.Y.Z → X.Y.Z+1)
  minor              Increment minor version (X.Y.Z → X.Y+1.0)
  major              Increment major version (X.Y.Z → X+1.0.0)
  X.Y.Z              Specify exact version

Options:
  --dry-run          Simulate publishing without actually publishing
  --skip-tests       Skip running tests
  --skip-git         Don't create commit or tag in git
  --help, -h         Show this help

Examples:
  npm run publish patch              # Increment patch version
  npm run publish 3.1.0              # Publish version 3.1.0
  npm run publish patch --dry-run    # Simulate publishing
  npm run publish                    # Interactive mode

The script:
  1. Updates versions in all package.json files
  2. Updates dependencies between packages
  3. Runs tests (optional)
  4. Publishes packages in correct order
  5. Creates commit and tag in git (optional)
`);
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

