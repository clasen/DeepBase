# Publishing Guide

Este documento describe cómo publicar nuevas versiones de DeepBase en npm.

## Prerequisitos

Antes de publicar, asegúrate de:

1. ✅ Estar logueado en npm: `npm whoami`
2. ✅ Tener permisos de publicación para los packages `deepbase*`
3. ✅ Estar en la rama `main` y con el código actualizado
4. ✅ Todos los tests deben pasar: `npm test`

## Script de Publicación

Hemos creado un script automatizado que:

- ✅ Actualiza las versiones en todos los `package.json`
- ✅ Sincroniza las dependencias entre packages
- ✅ Ejecuta todos los tests
- ✅ Publica los packages en el orden correcto
- ✅ Crea commit y tag en git

## Uso Básico

### Modo Interactivo (Recomendado)

```bash
npm run publish
```

Esto iniciará el modo interactivo donde puedes elegir:
- `patch`: Incrementa la versión patch (3.0.0 → 3.0.1)
- `minor`: Incrementa la versión minor (3.0.0 → 3.1.0)
- `major`: Incrementa la versión major (3.0.0 → 4.0.0)
- Especificar versión manualmente

### Modo Comando Rápido

```bash
# Incrementar versión patch
npm run publish:patch

# Incrementar versión minor
npm run publish:minor

# Incrementar versión major
npm run publish:major

# Especificar versión exacta
npm run publish 3.1.0
```

### Dry Run (Simulación)

Para probar sin publicar realmente:

```bash
npm run publish:dry
# o
npm run publish patch --dry-run
```

## Opciones Avanzadas

### Saltar Tests

```bash
npm run publish patch --skip-tests
```

⚠️ **No recomendado** - Úsalo solo si ya ejecutaste los tests manualmente.

### Saltar Git

```bash
npm run publish patch --skip-git
```

Útil si quieres hacer el commit y tag manualmente.

### Combinar Opciones

```bash
npm run publish 3.1.5 --skip-tests --dry-run
```

## Flujo Completo de Publicación

1. **Preparación**
   ```bash
   git checkout main
   git pull origin main
   npm test
   ```

2. **Publicación**
   ```bash
   npm run publish patch
   ```

3. **Push a Git**
   ```bash
   git push origin main
   git push --tags
   ```

4. **Verificación**
   - Verifica en https://www.npmjs.com/package/deepbase
   - Verifica que todas las versiones estén sincronizadas
   - Prueba instalando: `npm install deepbase@latest`

## Orden de Publicación

El script publica los packages en este orden:

1. `deepbase` (core) - No depende de nada
2. `deepbase-json` - Depende de deepbase
3. `deepbase-mongodb` - Depende de deepbase
4. `deepbase-redis` - Depende de deepbase
5. `deepbase-sqlite` - Depende de deepbase

Este orden asegura que las dependencias estén disponibles antes de publicar los packages que las usan.

## Gestión de Versiones

### Versionado Semántico (SemVer)

Seguimos [Semantic Versioning](https://semver.org/):

- **MAJOR** (X.0.0): Cambios incompatibles con versiones anteriores
- **MINOR** (0.X.0): Nueva funcionalidad compatible con versiones anteriores
- **PATCH** (0.0.X): Bug fixes compatibles con versiones anteriores

### Sincronización de Versiones

El script mantiene **todas las versiones sincronizadas** entre:
- El monorepo root
- Todos los packages individuales
- Las dependencias entre packages

Por ejemplo, si publicas la versión `3.1.0`:
- `deepbase`: `3.1.0`
- `deepbase-json`: `3.1.0`
- En `deepbase/package.json`: `"deepbase-json": "^3.1.0"`
- En `deepbase-mongodb/package.json`: `"deepbase": "^3.1.0"` (peerDependency)

## Troubleshooting

### Error: "Not logged in to npm"

```bash
npm login
```

### Error: "403 Forbidden"

No tienes permisos para publicar. Contacta al owner del package.

### Error en Tests

```bash
# Ejecuta tests individualmente para identificar el problema
npm run test:core
npm run test:json
npm run test:mongodb
npm run test:redis
npm run test:sqlite
```

### Revertir Cambios de Versión

Si algo sale mal y necesitas revertir las versiones:

```bash
git checkout -- package.json packages/*/package.json
```

### Package Ya Publicado

Si intentas publicar una versión que ya existe:
```
npm ERR! code E403
npm ERR! 403 403 Forbidden - PUT https://registry.npmjs.org/deepbase - You cannot publish over the previously published versions
```

Solución: Incrementa la versión y vuelve a intentar.

## Manual Publishing (Sin el Script)

Si necesitas publicar manualmente por alguna razón:

```bash
# 1. Actualizar versiones manualmente en cada package.json

# 2. Actualizar dependencias manualmente

# 3. Ejecutar tests
npm test

# 4. Publicar en orden
cd packages/core && npm publish --access public
cd ../driver-json && npm publish --access public
cd ../driver-mongodb && npm publish --access public
cd ../driver-redis && npm publish --access public
cd ../driver-sqlite && npm publish --access public

# 5. Commit y tag
git add .
git commit -m "chore: release vX.Y.Z"
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push && git push --tags
```

## Checklist de Publicación

Antes de publicar, verifica:

- [ ] Todos los tests pasan
- [ ] El CHANGELOG está actualizado
- [ ] La documentación (README) está actualizada
- [ ] No hay código de debug o console.logs innecesarios
- [ ] Los ejemplos funcionan correctamente
- [ ] Estás en la rama `main`
- [ ] Tienes los últimos cambios del repo

Después de publicar, verifica:

- [ ] Los packages aparecen en npmjs.com
- [ ] Las versiones están sincronizadas
- [ ] Se puede instalar: `npm install deepbase@latest`
- [ ] Los ejemplos funcionan con la nueva versión
- [ ] El tag de git fue creado
- [ ] Los cambios fueron pusheados a GitHub

## Script de Ayuda

```bash
node scripts/publish.js --help
```

Muestra todas las opciones disponibles y ejemplos de uso.
