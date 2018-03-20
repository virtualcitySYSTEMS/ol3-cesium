goog.provide('olcs.WMSRasterSynchronizer');

goog.require('goog.asserts');
goog.require('ol.array');
goog.require('ol');
goog.require('olcs.AbstractSynchronizer');
goog.require('olcs.core');
goog.require('ol.layer.Tile');
goog.require('ol.source.TileWMS');
goog.require('ol.layer.Group');
goog.require('ol.extent');
goog.require('ol.proj');


/**
 * This object takes care of one-directional synchronization of
 * Openlayers WMS raster layers to the given Cesium globe. This Synchronizer
 * assumes that the given WMS supports EPSG Code 4326 (WGS84)
 * @param {!ol.Map} map
 * @param {!Cesium.Scene} scene
 * @constructor
 * @extends {olcs.AbstractSynchronizer.<Cesium.ImageryLayer>}
 * @api
 * @struct
 */
olcs.WMSRasterSynchronizer = function(map, scene) {
  /**
   * @type {!Cesium.ImageryLayerCollection}
   * @private
   */
  this.cesiumLayers_ = scene.imageryLayers;

  /**
   * @type {!Cesium.ImageryLayerCollection}
   * @private
   */
  this.ourLayers_ = new Cesium.ImageryLayerCollection();

  olcs.AbstractSynchronizer.call(this, map, scene);
};
ol.inherits(olcs.WMSRasterSynchronizer, olcs.AbstractSynchronizer);


/**
 * @inheritDoc
 */
olcs.WMSRasterSynchronizer.prototype.addCesiumObject = function(object) {
  this.cesiumLayers_.add(object);
  this.ourLayers_.add(object);
};


/**
 * @inheritDoc
 */
olcs.WMSRasterSynchronizer.prototype.destroyCesiumObject = function(object) {
  object.destroy();
};


/**
 * @inheritDoc
 */
olcs.WMSRasterSynchronizer.prototype.removeSingleCesiumObject = function(object, destroy) {
  this.cesiumLayers_.remove(object, destroy);
  this.ourLayers_.remove(object, false);
};


/**
 * @inheritDoc
 */
olcs.WMSRasterSynchronizer.prototype.removeAllCesiumObjects = function(destroy) {
  for (let i = 0; i < this.ourLayers_.length; ++i) {
    this.cesiumLayers_.remove(this.ourLayers_.get(i), destroy);
  }
  this.ourLayers_.removeAll(false);
};


/**
 * Creates an array of Cesium.ImageryLayer.
 * May be overriden by child classes to implement custom behavior.
 * The default implementation handles tiled imageries in EPSG:4326 or
 * EPSG:3859.
 * @param {!ol.layer.Base} olLayer
 * @param {?ol.proj.Projection} viewProj Projection of the view.
 * @return {?Array.<!Cesium.ImageryLayer>} array or null if not possible
 * (or supported)
 * @protected
 */
olcs.WMSRasterSynchronizer.prototype.convertLayerToCesiumImageries = function(olLayer, viewProj) {
  if (!(olLayer instanceof ol.layer.Tile)) {
    return null;
  }

  let provider = null;

  const source = olLayer.getSource();
  if (source instanceof ol.source.TileWMS) {
    const params = source.getParams();
    const options = {
      'url': source.getUrls()[0],
      'parameters': params,
      'layers': params['LAYERS'],
      'show': false
    };
    const tileGrid = source.getTileGrid();
    if (tileGrid) {
      const ext = olLayer.getExtent();
      if (ext && viewProj) {
        options['rectangle'] = olcs.core.extentToRectangle(ext, viewProj);
        const minMax = this.getMinMaxLevelFromTileGrid(tileGrid, ext, viewProj);
        options['tileWidth'] = tileGrid.getTileSize(0)[0];
        options['tileHeight'] = tileGrid.getTileSize(0)[1];
        options['minimumLevel'] = minMax[0];
        options['maximumLevel'] = minMax[1];
      }
    }

    provider = new Cesium.WebMapServiceImageryProvider(options);
  } else {
    // sources other than TileImage are currently not supported
    return null;
  }

  // the provider is always non-null if we got this far

  const layerOptions = {
    'show': false
  };

  const cesiumLayer = new Cesium.ImageryLayer(provider, layerOptions);
  return cesiumLayer ? [cesiumLayer] : null;
};

/**
 *
 * @param {ol.Extent} extent
 * @param {ol.ProjectionLike} projection
 * @return {Array.<Cesium.Cartographic>}
 * @private
 */
olcs.WMSRasterSynchronizer.prototype.getExtentPoints_ = function(extent, projection) {
  const wgs84Extent = ol.proj.transformExtent(extent, projection, 'EPSG:4326');
  const olCoords = [
    ol.extent.getBottomLeft(wgs84Extent),
    ol.extent.getBottomRight(wgs84Extent),
    ol.extent.getTopRight(wgs84Extent),
    ol.extent.getTopLeft(wgs84Extent)
  ];
  return olCoords.map(coord => Cesium.Cartographic.fromDegrees(coord[0], coord[1]));
};
/**
 *
 * @param {ol.tilegrid.TileGrid} tilegrid
 * @param {ol.Extent} extent
 * @param {ol.ProjectionLike} projection
 * @return {Array.<Number>}
 */
olcs.WMSRasterSynchronizer.prototype.getMinMaxLevelFromTileGrid = function(tilegrid, extent, projection) {
  const olCoords = [
    ol.extent.getBottomLeft(extent),
    ol.extent.getBottomRight(extent),
    ol.extent.getTopRight(extent),
    ol.extent.getTopLeft(extent)
  ];
  const resolution = tilegrid.getResolutions().slice(-1).pop();
  const tileCoordsLocal = olCoords.map(position => tilegrid.getTileCoordForCoordAndResolution(position, resolution));
  const distanceLocalX  = Math.abs(tileCoordsLocal[0][1] - tileCoordsLocal[1][1]);
  const distanceLocalY  = Math.abs(tileCoordsLocal[0][2] - tileCoordsLocal[3][2]);
  const extentCoords = this.getExtentPoints_(extent, projection);
  const tilingScheme = new Cesium.GeographicTilingScheme({});
  let minLevel = 0;
  let maxLevel = 20;
  while (minLevel < maxLevel) {
    const tileCoords = extentCoords.map(position => tilingScheme.positionToTileXY(position, minLevel));
    const distances = [];
    distances.push(Math.abs(tileCoords[0]['x'] - tileCoords[1]['x']));
    distances.push(Math.abs(tileCoords[0]['y'] - tileCoords[3]['y']));
    if (distances[0] > 1 || distances[1] > 1) {
      minLevel--;
      break;
    }
    minLevel++;
  }
  while (maxLevel > minLevel) {
    const tileCoords = extentCoords.map(position => tilingScheme.positionToTileXY(position, maxLevel));
    const distances = [];
    distances.push(Math.abs(tileCoords[0]['x'] - tileCoords[1]['x']));
    distances.push(Math.abs(tileCoords[0]['y'] - tileCoords[3]['y']));
    if (distances[0] < distanceLocalX || distances[1] < distanceLocalY) {
      maxLevel++;
      break;
    }
    maxLevel--;
  }
  return [minLevel, maxLevel];
};


/**
 * @inheritDoc
 */
olcs.WMSRasterSynchronizer.prototype.createSingleLayerCounterparts = function(olLayerWithParents) {
  const olLayer = olLayerWithParents.layer;
  const uid = ol.getUid(olLayer).toString();
  const viewProj = this.view.getProjection();
  const cesiumObjects = this.convertLayerToCesiumImageries(olLayer, viewProj);
  if (cesiumObjects) {
    const listenKeyArray = [];
    [olLayerWithParents.layer].concat(olLayerWithParents.parents).forEach((olLayerItem) => {
      listenKeyArray.push(olLayerItem.on(['change:opacity', 'change:visible'], () => {
        // the compiler does not seem to be able to infer this
        goog.asserts.assert(cesiumObjects);
        for (let i = 0; i < cesiumObjects.length; ++i) {
          olcs.core.updateCesiumLayerProperties(olLayerWithParents, cesiumObjects[i]);
        }
      }));
    });

    for (let i = 0; i < cesiumObjects.length; ++i) {
      olcs.core.updateCesiumLayerProperties(olLayerWithParents, cesiumObjects[i]);
    }

    // there is no way to modify Cesium layer extent,
    // we have to recreate when OpenLayers layer extent changes:
    listenKeyArray.push(olLayer.on('change:extent', function(e) {
      for (let i = 0; i < cesiumObjects.length; ++i) {
        this.cesiumLayers_.remove(cesiumObjects[i], true); // destroy
        this.ourLayers_.remove(cesiumObjects[i], false);
      }
      delete this.layerMap[ol.getUid(olLayer)]; // invalidate the map entry
      this.synchronize();
    }, this));

    listenKeyArray.push(olLayer.on('change', function(e) {
      // when the source changes, re-add the layer to force update
      for (let i = 0; i < cesiumObjects.length; ++i) {
        const position = this.cesiumLayers_.indexOf(cesiumObjects[i]);
        if (position >= 0) {
          this.cesiumLayers_.remove(cesiumObjects[i], false);
          this.cesiumLayers_.add(cesiumObjects[i], position);
        }
      }
    }, this));

    this.olLayerListenKeys[uid].push(...listenKeyArray);
  }

  return Array.isArray(cesiumObjects) ? cesiumObjects : null;
};



/**
 * Order counterparts using the same algorithm as the Openlayers renderer:
 * z-index then original sequence order.
 * @override
 * @protected
 */
olcs.WMSRasterSynchronizer.prototype.orderLayers = function() {
  const layers = [];
  const zIndices = {};
  const queue = [this.mapLayerGroup];

  while (queue.length > 0) {
    const olLayer = queue.splice(0, 1)[0];
    layers.push(olLayer);
    zIndices[ol.getUid(olLayer)] = olLayer.getZIndex();

    if (olLayer instanceof ol.layer.Group) {
      const sublayers = olLayer.getLayers();
      if (sublayers) {
        // Prepend queue with sublayers in order
        queue.unshift(...sublayers.getArray());
      }
    }
  }

  ol.array.stableSort(layers, (layer1, layer2) =>
    zIndices[ol.getUid(layer1)] - zIndices[ol.getUid(layer2)]
  );

  layers.forEach(function(olLayer) {
    const olLayerId = ol.getUid(olLayer).toString();
    const cesiumObjects = this.layerMap[olLayerId];
    if (cesiumObjects) {
      cesiumObjects.forEach(this.raiseToTop, this);
    }
  }, this);
};


/**
 * @param {Cesium.ImageryLayer} counterpart
 */
olcs.WMSRasterSynchronizer.prototype.raiseToTop = function(counterpart) {
  this.cesiumLayers_.raiseToTop(counterpart);
};
