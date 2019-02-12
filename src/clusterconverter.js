goog.provide('olcs.ClusterConverter');

goog.require('goog.asserts');

goog.require('ol');
goog.require('ol.Feature');
goog.require('ol.events');

goog.require('olcs.core');
goog.require('olcs.util');
goog.require('olcs.FeatureConverter');
goog.require('olcs.core.ClusterLayerCounterpart');

/**
 * @constructor
 * @extends olcs.FeatureConverter
 * @api
 */
olcs.ClusterConverter = function(scene) {
  olcs.FeatureConverter.call(this, scene);

  /**
   * style functions for each cluster layer, where the key is the layer id.
   * @type {Object<string,Function>}
   * @private
   */
  this.layerStyleMap_ = {};

  /**
   * @type {Cesium.DataSourceCollection}
   * @private
   */
  this.dataSources_ = new Cesium.DataSourceCollection();
};
goog.inherits(olcs.ClusterConverter, olcs.FeatureConverter);

/**
 * @override
 * @param {!(ol.layer.Vector|ol.layer.Image)} olLayer
 * @param {!ol.View} olView
 * @param {!Object.<number, (!Cesium.Primitive|!Cesium.Entity)>} featureEntityMap
 * @return {!olcs.core.ClusterLayerCounterpart}
 */
olcs.ClusterConverter.prototype.olVectorLayerToCesium = function(olLayer, olView, featureEntityMap) {
  const proj = olView.getProjection();
  const resolution = olView.getResolution();

  if (resolution === undefined || !proj) {
    goog.asserts.fail('View not ready');
    // an assertion is not enough for closure to assume resolution and proj
    // are defined
    throw new Error('View not ready');
  }

  let source = olLayer.getSource();
  goog.asserts.assertInstanceof(source, ol.source.Cluster);
  source = source.getSource();

  goog.asserts.assertInstanceof(source, ol.source.Vector);
  const features = source.getFeatures();
  const counterpart = new olcs.core.ClusterLayerCounterpart(proj, this.scene, olLayer);
  const context = counterpart.context;
  context.featureEntityMap = featureEntityMap;
  for (let i = 0; i < features.length; ++i) {
    const feature = features[i];
    if (!feature) {
      continue;
    }

    const style = this.computePlainStyle(olLayer, feature, olLayer.getStyleFunction(),
      resolution);
    if (!style) {
      // only 'render' features with a style
      continue;
    }
    const entity = this.olFeatureToCesium(olLayer, feature, style, context);
    if (!entity) {
      continue;
    }
    featureEntityMap[ol.getUid(feature)] = entity;
    counterpart.getRootPrimitive().add(entity);
  }

  const dataSource = counterpart.getDataSource();
  dataSource.clustering.clusterEvent.addEventListener(this.clusterStyle.bind(this, olLayer));
  dataSource.clustering.enabled = true;
  return counterpart;
};

/**
 * @override
 * @return {Cesium.Entity}
 */
olcs.ClusterConverter.prototype.olFeatureToCesium = function(layer, feature, style, context, opt_geom) {
  let geom = opt_geom || feature.getGeometry();
  if (!geom || !(geom.getType() == 'Point')) {
    // OpenLayers features may not have a geometry
    // See http://geojson.org/geojson-spec.html#feature-objects
    return null;
  }

  geom = olcs.core.olGeometryCloneTo4326(geom, context.projection);
  geom = /** @type{!ol.geom.Geometry} */ (geom);
  const pointGeom = /** @type {!ol.geom.Point} */ (geom);

  const entityOptions = /** @type{Cesium.optionsEntity} */ ({});
  const center = pointGeom.getCoordinates();
  // google closure compiler warning fix
  const heightAboveGround = feature.get('olcs_heightAboveGround') || layer.get('olcs_heightAboveGround');
  if (typeof heightAboveGround == 'number') {
    /** number */
    center[2] = heightAboveGround;
  }

  const position = olcs.core.ol4326CoordinateToCesiumCartesian(center);
  entityOptions.position = position;
  entityOptions.id = feature.getId();


  if (style.getText()) {
    const text = /** @type {!ol.style.Text} */ (style.getText());
    entityOptions.label = this.olGeometry4326TextOptionsPartToCesium(layer, feature, geom, text);
  }

  const imageStyle = style.getImage();
  if (imageStyle) {
    if (imageStyle instanceof ol.style.Icon) {
      // make sure the image is scheduled for load
      imageStyle.load();
    }

    const image = imageStyle.getImage(1); // get normal density
    const isImageLoaded = function(image) {
      return image.src != '' &&
        image.naturalHeight != 0 &&
        image.naturalWidth != 0 &&
        image.complete;
    };
    const reallyCreateBillboard = (function() {
      if (!image) {
        return;
      }
      if (!(image instanceof HTMLCanvasElement ||
        image instanceof Image ||
        image instanceof HTMLImageElement)) {
        return;
      }

      let color;
      const opacity = imageStyle.getOpacity();
      if (opacity !== undefined) {
        color = new Cesium.Color(1.0, 1.0, 1.0, opacity);
      }

      let zCoordinateEyeOffset = feature.get('olcs_zCoordinateEyeOffset');

      if (typeof zCoordinateEyeOffset != 'number') {
        /** number */
        zCoordinateEyeOffset = 0;
      }
      geom = /** @type {!ol.geom.Geometry} */ (geom);
      const heightReference = this.getHeightReference(layer, feature, geom);

      entityOptions.billboard = /** @type{!Cesium.optionsBillboardCollectionAdd} */ ({
        image,
        color,
        scale: imageStyle.getScale(),
        heightReference,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        eyeOffset : new Cesium.Cartesian3(0,0, zCoordinateEyeOffset)
      });

      if (feature.get('olcs_scaleByDistance') && Array.isArray(feature.get('olcs_scaleByDistance') && feature.get('olcs_scaleByDistance').length === 4)) {
        const array = feature.get('olcs_scaleByDistance');
        entityOptions.billboard.scaleByDistance = new Cesium.NearFarScalar(array[0], array[1], array[2], array[3]);
      }
      const entity = new Cesium.Entity(entityOptions);
      this.setEntityRefForPicking(layer, feature, entity);
      return entity;
    }).bind(this);

    if (image instanceof Image && !isImageLoaded(image)) {
      let cancelled = false;
      let source = /** @type {ol.source.Cluster} */ (layer.getSource());
      source = source.getSource();

      const canceller = function() {
        cancelled = true;
      };
      // source.on(['removefeature', 'clear'],
      //   this.boundOnRemoveOrClearFeatureListener_);
      let cancellers = olcs.util.obj(source)['olcs_cancellers'];
      if (!cancellers) {
        cancellers = olcs.util.obj(source)['olcs_cancellers'] = {};
      }

      const fuid = ol.getUid(feature);
      if (cancellers[fuid]) {
        // When the feature change quickly, a canceller may still be present so
        // we cancel it here to prevent creation of a billboard.
        cancellers[fuid]();
      }
      cancellers[fuid] = canceller;

      const listener = function() {
        if (!context.entities.isDestroyed() && !cancelled) {
          // Create billboard if the feature is still displayed on the map.
          const entity = reallyCreateBillboard();
          context.featureEntityMap[ol.getUid(feature)] = entity;
        }
      };
      ol.events.listenOnce(image, 'load', listener);
    } else {
      return reallyCreateBillboard();
    }
  }
  const entity = new Cesium.Entity(entityOptions);
  this.setEntityRefForPicking(layer, feature, entity);
  return entity;
};

/**
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature OpenLayers feature.
 * @param {!Cesium.Entity} entity
 */
olcs.ClusterConverter.prototype.setEntityRefForPicking = function(layer, feature, entity) {
  entity.olLayer = layer;
  entity.olFeature = feature;
};

/**
 * Convert an OpenLayers text style to Cesium.
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature OpenLayers feature..
 * @param {!ol.geom.Geometry} geometry
 * @param {!ol.style.Text} style
 * @return {Cesium.optionsLabelCollection} Cesium label options
 */
olcs.ClusterConverter.prototype.olGeometry4326TextOptionsPartToCesium = function(layer, feature, geometry, style) {
  const text = style.getText();
  goog.asserts.assert(text !== undefined);

  const options = /** @type {Cesium.optionsLabelCollection} */ ({});

  options.text = text;

  options.heightReference = this.getHeightReference(layer, feature, geometry);

  const offsetX = style.getOffsetX();
  const offsetY = style.getOffsetY();
  if (offsetX != 0 && offsetY != 0) {
    const offset = new Cesium.Cartesian2(offsetX, offsetY);
    options.pixelOffset = offset;
  }

  const font = style.getFont();
  if (font !== undefined) {
    options.font = font;
  }

  let labelStyle = undefined;
  if (style.getFill()) {
    options.fillColor = this.extractColorFromOlStyle(style, false);
    labelStyle = Cesium.LabelStyle.FILL;
  }
  if (style.getStroke()) {
    options.outlineWidth = this.extractLineWidthFromOlStyle(style);
    options.outlineColor = this.extractColorFromOlStyle(style, true);
    labelStyle = Cesium.LabelStyle.OUTLINE;
  }
  if (style.getFill() && style.getStroke()) {
    labelStyle = Cesium.LabelStyle.FILL_AND_OUTLINE;
  }
  options.style = labelStyle;

  let horizontalOrigin;
  switch (style.getTextAlign()) {
    case 'left':
      horizontalOrigin = Cesium.HorizontalOrigin.LEFT;
      break;
    case 'right':
      horizontalOrigin = Cesium.HorizontalOrigin.RIGHT;
      break;
    case 'center':
    default:
      horizontalOrigin = Cesium.HorizontalOrigin.CENTER;
  }
  options.horizontalOrigin = horizontalOrigin;

  if (style.getTextBaseline()) {
    let verticalOrigin;
    switch (style.getTextBaseline()) {
      case 'top':
        verticalOrigin = Cesium.VerticalOrigin.TOP;
        break;
      case 'middle':
        verticalOrigin = Cesium.VerticalOrigin.CENTER;
        break;
      case 'bottom':
        verticalOrigin = Cesium.VerticalOrigin.BOTTOM;
        break;
      case 'alphabetic':
        verticalOrigin = Cesium.VerticalOrigin.TOP;
        break;
      case 'hanging':
        verticalOrigin = Cesium.VerticalOrigin.BOTTOM;
        break;
      default:
        goog.asserts.fail(`unhandled baseline ${style.getTextBaseline()}`);
    }
    options.verticalOrigin = verticalOrigin;
  }

  return options;
};

/**
 * Sets a layers style function. To unset a previously set style function, pass null as the second argument
 * @param {ol.layer.Layer} layer
 * @param {Function|null} styleFunction
 * @api
 */
olcs.ClusterConverter.prototype.setLayerStyle = function(layer, styleFunction) {
  const id = ol.getUid(layer).toString();
  goog.asserts.assertString(id);
  if (styleFunction !== null) {
    goog.asserts.assertFunction(styleFunction);
  }

  this.layerStyleMap_[id] = styleFunction;
};

/**
 * Specifies the style function to use for a cluster and its entities
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {Array<Cesium.Entity>} entities
 * @param {Object} cluster
 */
olcs.ClusterConverter.prototype.clusterStyle = function(layer, entities, cluster) {
  cluster.label.show = false;
  cluster.label.entities = entities;
  cluster.billboard.id = cluster.label.id;
  cluster.billboard.entities = entities;

  let zCoordinateEyeOffset = layer.get('olcs_zCoordinateEyeOffset');
  if (typeof zCoordinateEyeOffset != 'number') {
    /** number */
    zCoordinateEyeOffset = 0;
  }
  cluster.billboard.eyeOffset = new Cesium.Cartesian3(0,0, zCoordinateEyeOffset);
  cluster.label.eyeOffset = new Cesium.Cartesian3(0,0, zCoordinateEyeOffset);

  const altitudeMode = layer.get('olcs_altitudeMode');
  let heightReference = Cesium.HeightReference.NONE;
  if (altitudeMode === 'clampToGround') {
    heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
  } else if (altitudeMode === 'relativeToGround') {
    heightReference = Cesium.HeightReference.RELATIVE_TO_GROUND;
  }
  cluster.billboard.heightReference = heightReference;
  cluster.label.heightReference = heightReference;
  cluster.billboard.verticalOrigin = Cesium.VerticalOrigin.BOTTOM;

  const id = ol.getUid(layer).toString();
  let specificClusterStyle = this.layerStyleMap_[id];
  if (specificClusterStyle && typeof specificClusterStyle === 'function') {
    specificClusterStyle(entities, cluster);
  } else {
    let features = entities;
    if (entities.length === 1) {
      const source = /** @type {!ol.source.Cluster} */ (layer.getSource());
      features = [source.getSource().getFeatureById(entities[0].id)];
    }
    const style = layer.getStyleFunction()(new ol.Feature({ features }), 1);
    if (style.getImage()) {
      this._getClusterImageStyle(style.getImage(), cluster.billboard);
    }
    if (style.getText()) {
      Object.assign(cluster.label, this._getClusterTextStyle(style.getText()));
    }
  }
};

olcs.ClusterConverter.prototype._getClusterImageStyle = function(style, clusterBillboard) {
  if (style instanceof ol.style.Icon) {
    style.load();
  }

  const image = style.getImage(1); // get normal density
  const isImageLoaded = function(image) {
    return image.src != '' &&
      image.naturalHeight != 0 &&
      image.naturalWidth != 0 &&
      image.complete;
  };
  const setBillboard = (function() {
    if (!image) {
      return;
    }
    if (!(image instanceof HTMLCanvasElement ||
      image instanceof Image ||
      image instanceof HTMLImageElement)) {
      return;
    }
    let color;
    const opacity = style.getOpacity();
    if (opacity !== undefined) {
      color = new Cesium.Color(1.0, 1.0, 1.0, opacity);
    }

    Object.assign(clusterBillboard, {
      image,
      color,
      scale: style.getScale(),
      show: true,
    });
  }).bind(this);

  if (image instanceof Image && !isImageLoaded(image)) {
    const listener = function() {
      setBillboard();
    };
    ol.events.listenOnce(image, 'load', listener);
  } else {
    setBillboard();
  }
};

olcs.ClusterConverter.prototype._getClusterTextStyle = function(style) {
  const options = {};
  options.text = style.getText();
  options.show = true;

  const offsetX = style.getOffsetX();
  const offsetY = style.getOffsetY();
  if (offsetX != 0 && offsetY != 0) {
    const offset = new Cesium.Cartesian2(offsetX, offsetY);
    options.pixelOffset = offset;
  }

  const font = style.getFont() || '10px sans-serif';
  if (font !== undefined) {
    options.font = font;
  }

  let labelStyle = undefined;
  if (style.getFill()) {
    options.fillColor = this.extractColorFromOlStyle(style, false);
    labelStyle = Cesium.LabelStyle.FILL;
  }
  if (style.getStroke()) {
    options.outlineWidth = this.extractLineWidthFromOlStyle(style);
    options.outlineColor = this.extractColorFromOlStyle(style, true);
    labelStyle = Cesium.LabelStyle.OUTLINE;
  }
  if (style.getFill() && style.getStroke()) {
    labelStyle = Cesium.LabelStyle.FILL_AND_OUTLINE;
  }
  options.style = labelStyle;

  let horizontalOrigin;
  switch (style.getTextAlign()) {
    case 'left':
      horizontalOrigin = Cesium.HorizontalOrigin.LEFT;
      break;
    case 'right':
      horizontalOrigin = Cesium.HorizontalOrigin.RIGHT;
      break;
    case 'center':
    default:
      horizontalOrigin = Cesium.HorizontalOrigin.CENTER;
  }
  options.horizontalOrigin = horizontalOrigin;
  if (style.getTextBaseline()) {
    let verticalOrigin;
    switch (style.getTextBaseline()) {
      case 'top':
        verticalOrigin = Cesium.VerticalOrigin.TOP;
        break;
      case 'middle':
        verticalOrigin = Cesium.VerticalOrigin.CENTER;
        break;
      case 'bottom':
        verticalOrigin = Cesium.VerticalOrigin.BOTTOM;
        break;
      case 'alphabetic':
        verticalOrigin = Cesium.VerticalOrigin.TOP;
        break;
      case 'hanging':
        verticalOrigin = Cesium.VerticalOrigin.BOTTOM;
        break;
      default:
        goog.asserts.fail(`unhandled baseline ${style.getTextBaseline()}`);
    }
    options.verticalOrigin = verticalOrigin;
  }
  return options;
};
