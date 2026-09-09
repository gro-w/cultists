/**
 * Core-side host for declarative framework packages.
 * It exposes only generic data collection and lifecycle hooks; framework
 * managers (inventory, achievements, keywords, etc.) are authored as NGL
 * activities and framework data, never implemented here.
 */
export function createFrameworkRuntime({ dataStore, definition = {} } = {}) {
  const collections = definition.collections || {};
  return {
    keywordManager: null,
    runtimeGateway: {
      getCollection(collectionId) {
        const declaration = collections[collectionId];
        if (!declaration) return [];
        return dataStore.findRecords(declaration.databaseId, declaration.query || {});
      },
    },
    customWidgetFactories: {},
    stateProviders: {},
    runtimeStores: {},
    saveableVariable: (key, value) => {
      const excluded = definition.saveableVariableExclusions || [];
      const prefixes = definition.saveableVariablePrefixes || [];
      return !excluded.includes(key) && !prefixes.some((prefix) => String(key).startsWith(prefix))
        && (value === null || ["boolean", "number", "string"].includes(typeof value));
    },
  };
}

export default createFrameworkRuntime;
