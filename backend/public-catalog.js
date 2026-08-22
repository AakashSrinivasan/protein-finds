'use strict';

const clone = value => value === undefined ? undefined : structuredClone(value);

function publicCatalog(catalog, {revision, servedAt}) {
  return {
    version: catalog.version,
    revision,
    generatedAt: catalog.generatedAt,
    servedAt,
    notice: catalog.fixtureNotice || null,
    products: catalog.products.map(product => ({
      id: product.id, kind: product.kind, name: product.name, category: product.category,
      markets: clone(product.markets), identity: clone(product.identity), dietaryTags: clone(product.dietaryTags),
      allergens: clone(product.allergens), preparationMinutes: product.preparationMinutes, images: clone(product.images)
    })),
    stores: catalog.stores.map(store => ({
      id: store.id, name: store.name, kind: store.kind, location: clone(store.location), externalId: store.externalId
    })),
    sources: catalog.sources.map(source => ({
      id: source.id, kind: source.kind, title: source.title, publisher: source.publisher,
      locator: source.locator, accessedAt: source.accessedAt
    })),
    mediaAssets: catalog.mediaAssets.map(asset => ({
      id: asset.id, productId: asset.productId, role: asset.role, locator: asset.locator, sha256: asset.sha256,
      sourceId: asset.sourceId, license: asset.license, capturedAt: asset.capturedAt,
      verificationState: asset.verificationState, identityBinding: clone(asset.identityBinding)
    })),
    observations: catalog.observations.map(observation => ({
      id: observation.id, productId: observation.productId, storeId: observation.storeId, field: observation.field,
      value: clone(observation.value), sourceId: observation.sourceId, observedAt: observation.observedAt,
      verificationState: observation.verificationState, conflictId: observation.conflictId
    })),
    conflicts: catalog.conflicts.map(conflict => ({
      id: conflict.id, productId: conflict.productId, field: conflict.field,
      observationIds: clone(conflict.observationIds), status: conflict.status,
      resolution: conflict.resolution ? {
        winningObservationId: conflict.resolution.winningObservationId,
        reviewedAt: conflict.resolution.reviewedAt
      } : null
    }))
  };
}

module.exports = {publicCatalog};
