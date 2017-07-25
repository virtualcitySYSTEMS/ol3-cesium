goog.provide('olcs.ClusterConverter');
goog.require('olcs.FeatureConverter');

goog.require('olcs.core.ClusterLayerCounterpart');
/**
 * @constructor
 * @extends olcs.FeatureConverter
 */
olcs.ClusterConverter = function(scene) {
  goog.base(this, scene);

  this.dataSources_ = new Cesium.DataSourceCollection();
};
goog.inherits(olcs.ClusterConverter, olcs.FeatureConverter);

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
  return counterpart;
};

/** @retun{Cesium.Entity} */
olcs.ClusterConverter.prototype.olFeatureToCesium = function(layer, feature, style, context, opt_geom) {
  let geom = opt_geom || feature.getGeometry();
  const proj = context.projection;
  if (!geom || !(geom.getType() == 'Point')) {
    // OpenLayers features may not have a geometry
    // See http://geojson.org/geojson-spec.html#feature-objects
    return null;
  }

  geom = olcs.core.olGeometryCloneTo4326(geom, context.projection);

  const imageStyle = style.getImage();
  let entityOptions = {};

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
      const center = geom.getCoordinates();

      // google closure compiler warning fix
      const heightAboveGround = feature.get("heightAboveGround");
      if (typeof heightAboveGround == 'number') {
        /** number */
        center[2] = heightAboveGround;
      }

      const position = olcs.core.ol4326CoordinateToCesiumCartesian(center);
      let color;
      const opacity = imageStyle.getOpacity();
      if (opacity !== undefined) {
        color = new Cesium.Color(1.0, 1.0, 1.0, opacity);
      }

      let zCoordinateEyeOffset = feature.get("zCoordinateEyeOffset");

      if (typeof zCoordinateEyeOffset != 'number') {
        /** number */
        zCoordinateEyeOffset = 0;
      }

      const heightReference = this.getHeightReference(layer, feature, geom);

      entityOptions = {
        position,
        id : feature.getId(),
        billboard: {
          // always update Cesium externs before adding a property
          image,
          color,
          scale: imageStyle.getScale(),
          heightReference,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          eyeOffset : new Cesium.Cartesian3(0,0, zCoordinateEyeOffset)
        }
      };

      if (feature.get("scaleByDistance") && Array.isArray(feature.get("scaleByDistance") && feature.get("scaleByDistance").length === 4 )) {
        const array = feature.get("scaleByDistance");
        entityOptions.billboard.scaleByDistance = new Cesium.NearFarScalar(array[0], array[1], array[2], array[3]);
      }
      const entity = new Cesium.Entity(entityOptions);
      this.setReferenceForPicking(layer, feature, entity);
      return entity;
    }).bind(this);

    if (image instanceof Image && !isImageLoaded(image)) {
      // Cesium requires the image to be loaded
      let cancelled = false;
      let source = layer.getSource();
      source = source.getSource();

      const canceller = function() {
        cancelled = true;
      };
      source.on(['removefeature', 'clear'],
        this.boundOnRemoveOrClearFeatureListener_);
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
      console.log('unhandeld billboard with image?');
      ol.events.listenOnce(image, 'load', listener);
    } else {
      return reallyCreateBillboard();
    }
  }

  if (style.getText()) {
    const labels = this.olGeometry4326TextPartToCesium(layer, feature, geom, style.getText());
    const textPosition = olcs.core.ol4326CoordinateToCesiumCartesian(geom.getCoordinates());
    const textEntity = new Cesium.Entity({ position: textPosition, label: labels });
    this.setReferenceForPicking(layer, feature, textEntity);
    return textEntity;
  } else {
    return null;
  }
};

olcs.ClusterConverter.prototype.clusterStyle = function(layer, entities, cluster) {
  cluster.label.show = false;
  cluster.label.entities = entities;
  cluster.billboard.id = cluster.label.id;
  cluster.billboard.entities = entities;
  let features = entities;
  if (entities.length === 1) {
    features = [layer.getSource().getSource().getFeatureById(entities[0].id)];
  }
  const style = layer.getStyleFunction()(new ol.Feature({ features }));
  if (style.getImage()) {
    this._getClusterImageStyle(style.getImage(), cluster.billboard);
  }
  if (style.getText()) {
    Object.assign(cluster.label, this._getClusterTextStyle(style.getText()));
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
      setBillboard(clusterBillboard);
    };
    console.log('unhandeld billboard with image?');
    ol.events.listenOnce(image, 'load', listener);
  } else {
    setBillboard(clusterBillboard);
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
