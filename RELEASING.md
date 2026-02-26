# Releasing @posthook/node

## Release repo

https://github.com/posthook/posthook-node

## Registry

https://www.npmjs.com/package/@posthook/node

## Steps

1. **Bump the version** (updates `package.json` and creates a git tag):

   ```bash
   npm version patch   # or minor / major
   ```

2. **Run tests**:

   ```bash
   npm test
   ```

3. **Publish to npm**:

   ```bash
   npm publish --access public
   ```

4. **Push the commit and tag**:

   ```bash
   git push origin main --tags
   ```

5. **Create GitHub release**:

   ```bash
   gh release create v1.1.0 --title "v1.1.0" --notes "Release notes here"
   ```

## Prerequisites

- npm account with publish access to the `@posthook` org
- Logged in via `npm login`

## Versioning

Follow [semver](https://semver.org/):

- **Patch** (1.0.x): Bug fixes, doc updates
- **Minor** (1.x.0): New features, backward-compatible changes
- **Major** (x.0.0): Breaking API changes
