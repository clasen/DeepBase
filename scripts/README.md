# Publishing Scripts

Este directorio contiene scripts para gestionar la publicación de packages.

## publish.js

Script automatizado para publicar todos los packages de DeepBase en npm.

### Características

✅ Actualiza versiones en todos los `package.json`  
✅ Sincroniza dependencias entre packages  
✅ Ejecuta tests antes de publicar  
✅ Publica en el orden correcto  
✅ Crea commits y tags en git  
✅ Modo dry-run para probar sin publicar  

### Uso Rápido

```bash
# Modo interactivo
npm run publish

# Incrementar versión patch
npm run publish:patch

# Incrementar versión minor  
npm run publish:minor

# Incrementar versión major
npm run publish:major

# Dry run (simular sin publicar)
npm run publish:dry
```

### Documentación Completa

Ver [PUBLISHING.md](../PUBLISHING.md) en la raíz del proyecto para documentación completa.

### Opciones

- `--dry-run`: Simula sin publicar realmente
- `--skip-tests`: Salta la ejecución de tests
- `--skip-git`: No crea commit ni tag

### Ejemplos

```bash
# Publicar versión específica
npm run publish 3.1.0

# Simular incremento patch
npm run publish patch --dry-run

# Publicar sin tests (no recomendado)
npm run publish minor --skip-tests

# Ver ayuda
node scripts/publish.js --help
```

## Notas Importantes

⚠️ **Versiones Desincronizadas**: Si algunos packages tienen versiones diferentes (ej: mongodb: 3.0.2 vs core: 3.0.0), el script mostrará una advertencia. Debes elegir una versión mayor que TODAS las existentes, o usar una versión mayor (ej: 3.0.3 o 3.1.0).

⚠️ **Dry Run Modifica package.json**: El modo `--dry-run` modifica temporalmente los `package.json`. Si cancelas el proceso, puedes revertir con `git checkout -- package.json packages/*/package.json` (si tienes git inicializado).

⚠️ **Orden de Publicación**: El script publica en este orden para respetar dependencias:
1. deepbase (core)
2. deepbase-json
3. deepbase-mongodb  
4. deepbase-redis
5. deepbase-sqlite

