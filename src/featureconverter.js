goog.provide('olcs.FeatureConverter');

goog.require('goog.asserts');
goog.require('ol');
goog.require('ol.events');
goog.require('ol.extent');
goog.require('ol.source.Vector');
goog.require('ol.source.ImageVector');

goog.require('ol.geom.SimpleGeometry');
goog.require('ol.geom.LineString');
goog.require('ol.geom.Polygon');
goog.require('olcs.core');
goog.require('olcs.core.VectorLayerCounterpart');
goog.require('olcs.util');

/**
 * @typedef {Object} olcs.HeightInfo
 * @property {number|undefined} extrudedHeight - the height above ground level to extrude
 * @property {number|undefined} groundLevel - the level above mean sea level
 * @property {number|undefined} skirt - a negative height to <i>push</i> tje geometry into the ground by
 * @property {number|undefined} storeyNumber - number of stories to fit into the given extrusion. requires storeyHeight or extrudedHeight
 * @property {number|undefined} storeyHeight - height in meters of each storey. requires storeyNumber or extrudedHeight
 */
olcs.HeightInfo;

/**
 * Concrete base class for converting from OpenLayers3 vectors to Cesium
 * primitives.
 * Extending this class is possible provided that the extending class and
 * the library are compiled together by the closure compiler.
 * @param {!Cesium.Scene} scene Cesium scene.
 * @constructor
 * @api
 * @struct
 */
olcs.FeatureConverter = function(scene) {

  /**
   * @protected
   */
  this.scene = scene;

  /**
   * Bind once to have a unique function for using as a listener
   * @type {function(ol.source.Vector.Event)}
   * @private
   */
  this.boundOnRemoveOrClearFeatureListener_ =
      this.onRemoveOrClearFeature_.bind(this);

  /**
   * @type {Object<string, Cesium.ClassificationType>}
   * @private
   */
  this.classificationTypes_ = {
    'both': Cesium.ClassificationType.BOTH,
    'cesium3DTile': Cesium.ClassificationType.CESIUM_3D_TILE,
    'terrain': Cesium.ClassificationType.TERRAIN,
  };
};


/**
 * @param {ol.source.Vector.Event} evt
 * @private
 */
olcs.FeatureConverter.prototype.onRemoveOrClearFeature_ = function(evt) {
  const source = evt.target;
  goog.asserts.assertInstanceof(source, ol.source.Vector);

  const cancellers = olcs.util.obj(source)['olcs_cancellers'];
  if (cancellers) {
    const feature = evt.feature;
    if (feature) {
      // remove
      const id = ol.getUid(feature);
      const canceller = cancellers[id];
      if (canceller) {
        canceller();
        delete cancellers[id];
      }
    } else {
      // clear
      for (const key in cancellers) {
        if (cancellers.hasOwnProperty(key)) {
          cancellers[key]();
        }
      }
      olcs.util.obj(source)['olcs_cancellers'] = {};
    }
  }
};


/**
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature OpenLayers feature.
 * @param {!Cesium.Primitive|Cesium.Label|Cesium.Billboard} primitive
 * @protected
 */
olcs.FeatureConverter.prototype.setReferenceForPicking = function(layer, feature, primitive) {
  primitive.olLayer = layer;
  primitive.olFeature = feature;
};


/**
 * Basics primitive creation using a color attribute.
 * Note that Cesium has 'interior' and outline geometries.
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature OpenLayers feature.
 * @param {!ol.geom.Geometry} olGeometry OpenLayers geometry.
 * @param {!(Cesium.Geometry|Array<Cesium.Geometry>)} geometry
 * @param {Cesium.Color|HTMLCanvasElement} color
 * @param {olcs.HeightInfo|null} heightInfo
 * @param {number=} opt_lineWidth
 * @param {boolean=} flat
 * @return {Cesium.Primitive}
 * @protected
 */
olcs.FeatureConverter.prototype.createColoredPrimitive = function(layer, feature, olGeometry, geometry, color, heightInfo, opt_lineWidth, flat) {
  const createInstance = function(geometry, color) {
    let options;
    if (color instanceof HTMLCanvasElement) {
      options = { geometry };
    } else {
      options = {
        geometry,
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(color)
        }
      };
    }
    return new Cesium.GeometryInstance(options);
  };

  const options = {
    // always update Cesium externs before adding a property
    flat: !!flat,
    renderState: {
      depthTest: {
        enabled: true
      }
    },
    translucent: color["alpha"] !== 1
  };

  if (opt_lineWidth !== undefined) {
    if (!options.renderState) {
      options.renderState = {};
    }
    options.renderState.lineWidth = 1;
  }

  const instances = Array.isArray(geometry) ?
    geometry.map(g => createInstance(g, color)) :
    createInstance(geometry, color);

  const heightReference = this.getHeightReference(layer, feature, olGeometry);
  const allowPicking = this.getAllowPicking(layer, feature, olGeometry);

  let primitive;
  let appearance;
  if (color instanceof HTMLCanvasElement) {
    options.material = Cesium.Material.fromType('Wallpaper', {
      image: color,
      anchor: Cesium.SceneTransforms.wgs84ToDrawingBufferCoordinates(
        this.scene,
        Cesium.Cartesian3.fromDegreesArray(ol.extent.getBottomLeft(olGeometry.getExtent()))[0]
      ),
    });
    appearance = new Cesium.MaterialAppearance(options);
  } else {
    appearance = new Cesium.PerInstanceColorAppearance(options);
  }

  const classificationType = this.getClassificationType(layer, feature);
  if (
    heightReference == Cesium.HeightReference.CLAMP_TO_GROUND &&
    !heightInfo
  ) {
    const ctor = instances.geometry.constructor;
    if (ctor && !ctor['createShadowVolume']) {
      return null;
    }

    const primitiveOptions = {
      // always update Cesium externs before adding a property
      geometryInstances: instances,
      classificationType: classificationType != null ? classificationType : this.classificationTypes_['terrain'],
      allowPicking,
    };

    if (color instanceof HTMLCanvasElement) {
      primitiveOptions.appearance = appearance;
    }

    primitive = new Cesium.GroundPrimitive(primitiveOptions);
  } else if (Cesium.ClassificationPrimitive.isSupported(this.scene) && classificationType != null) {
    primitive = new Cesium.ClassificationPrimitive({
      // always update Cesium externs before adding a property
      geometryInstances: instances,
      appearance,
      shadows : Cesium.ShadowMode.ENABLED,
      allowPicking,
      classificationType,
    });
  } else {
    primitive = new Cesium.Primitive({
      // always update Cesium externs before adding a property
      geometryInstances: instances,
      appearance,
      shadows : Cesium.ShadowMode.ENABLED,
      allowPicking
    });
  }


  if (allowPicking) {
    this.setReferenceForPicking(layer, feature, primitive);
  }
  return primitive;
};


/**
 * Return the fill or stroke color from a plain ol style.
 * @param {!ol.style.Style|ol.style.Text} style
 * @param {boolean} outline
 * @return {!Cesium.Color}
 * @protected
 */
olcs.FeatureConverter.prototype.extractColorFromOlStyle = function(style, outline) {
  const fillColor = style.getFill() ? style.getFill().getColor() : null;
  const strokeColor = style.getStroke() ? style.getStroke().getColor() : null;

  let olColor = 'black';
  if (strokeColor && outline) {
    olColor = strokeColor;
  } else if (fillColor) {
    olColor = fillColor;
  }

  return olcs.core.convertColorToCesium(olColor);
};

/**
 * @param {!ol.style.Style} style
 * @return {Cesium.Color|HTMLCanvasElement}
 */
olcs.FeatureConverter.prototype.extractFillColorFromStyle = function(style) {
  const fill = style.getFill();
  let olColor = 'black';
  if (fill) {
    olColor = fill.getColor();
    if (olColor instanceof CanvasPattern) {
      if (!Cesium.GroundPrimitive.supportsMaterials(this.scene)) {
        olColor = fill['fallBackColor'] || olColor;
      } else {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = olColor;
        ctx.fillRect(0, 0, 300, 300);
        return /** @type {HTMLCanvasElement} */ (canvas);
      }
    }
  }
  return olcs.core.convertColorToCesium(olColor);
};

/**
 * Return the width of stroke from a plain ol style.
 * @param {!ol.style.Style|ol.style.Text} style
 * @return {number}
 * @protected
 */
olcs.FeatureConverter.prototype.extractLineWidthFromOlStyle = function(style) {
  // Handling of line width WebGL limitations is handled by Cesium.
  const width = style.getStroke() ? style.getStroke().getWidth() : undefined;
  return width !== undefined ? width : 0;
};


/**
 * Create a primitive collection out of two Cesium geometries.
 * Only the OpenLayers style colors will be used.
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature OpenLayers feature.
 * @param {!ol.geom.Geometry} olGeometry OpenLayers geometry.
 * @param {!(Cesium.Geometry|Array<Cesium.Geometry>)} fillGeometry
 * @param {Cesium.Geometry|Array<Cesium.Geometry>|undefined} outlineGeometry
 * @param {!ol.style.Style} olStyle
 * @param {olcs.HeightInfo|null} heightInfo
 * @return {!Cesium.PrimitiveCollection}
 * @protected
 */
olcs.FeatureConverter.prototype.wrapFillAndOutlineGeometries = function(layer, feature, olGeometry, fillGeometry, outlineGeometry, olStyle, heightInfo) {
  const primitives = new Cesium.PrimitiveCollection();
  if (olStyle.getFill()) {
    const fillColor = this.extractFillColorFromStyle(olStyle);
    const p1 = this.createColoredPrimitive(layer, feature, olGeometry,
        fillGeometry, fillColor, heightInfo);
    goog.asserts.assert(!!p1);
    primitives.add(p1);
  }

  if (olStyle.getStroke() && outlineGeometry) {
    const width = this.extractLineWidthFromOlStyle(olStyle);
    if (width) {
      const outlineColor = this.extractColorFromOlStyle(olStyle, true);
      const p2 = this.createColoredPrimitive(layer, feature, olGeometry,
        outlineGeometry, outlineColor, heightInfo, width, true);
      if (p2) {
        // Some outline geometries are not supported by Cesium in clamp to ground
        // mode. These primitives are skipped.
        primitives.add(p2);
      }
    }
  }

  return primitives;
};


// Geometry converters
/**
 * Create a Cesium primitive if style has a text component.
 * Eventually return a PrimitiveCollection including current primitive.
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature OpenLayers feature..
 * @param {!ol.geom.Geometry} geometry
 * @param {!ol.style.Style} style
 * @param {!Cesium.Primitive} primitive current primitive
 * @return {!Cesium.PrimitiveCollection}
 * @protected
 */
olcs.FeatureConverter.prototype.addTextStyle = function(layer, feature, geometry, style, primitive) {
  let primitives;
  if (!(primitive instanceof Cesium.PrimitiveCollection)) {
    primitives = new Cesium.PrimitiveCollection();
    primitives.add(primitive);
  } else {
    primitives = primitive;
  }

  if (!style.getText() || !style.getText().getText()) {
    return primitives;
  }

  const text = /** @type {!ol.style.Text} */ (style.getText());
  const label = this.olGeometry4326TextPartToCesium(layer, feature, geometry,
      text);
  if (label) {
    primitives.add(label);
  }
  return primitives;
};


/**
 * Add a billboard to a Cesium.BillboardCollection.
 * Overriding this wrapper allows manipulating the billboard options.
 * @param {!Cesium.BillboardCollection} billboards
 * @param {!Cesium.optionsBillboardCollectionAdd} bbOptions
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature OpenLayers feature.
 * @param {!ol.geom.Geometry} geometry
 * @param {!ol.style.Style} style
 * @return {!Cesium.Billboard} newly created billboard
 * @api
 */
olcs.FeatureConverter.prototype.csAddBillboard = function(billboards, bbOptions, layer, feature, geometry, style) {
  const bb = billboards.add(bbOptions);
  this.setReferenceForPicking(layer, feature, bb);
  return bb;
};


/**
 * Convert an OpenLayers circle geometry to Cesium.
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature OpenLayers feature..
 * @param {!ol.geom.Circle} olGeometry OpenLayers circle geometry.
 * @param {!ol.ProjectionLike} projection
 * @param {!ol.style.Style} olStyle
 * @return {!Cesium.PrimitiveCollection} primitives
 * @api
 */
olcs.FeatureConverter.prototype.olCircleGeometryToCesium = function(layer, feature, olGeometry, projection, olStyle) {

  olGeometry = olcs.core.olGeometryCloneTo4326(olGeometry, projection);
  goog.asserts.assert(olGeometry.getType() == 'Circle');

  let outlinePrimitive, outlineGeometry, fillGeometry;

  // ol.Coordinate
  const olCenter = olGeometry.getCenter();
  let point = olCenter.slice();
  point[0] += olGeometry.getRadius();

  // Cesium
  const center = olcs.core.ol4326CoordinateToCesiumCartesian(olCenter);
  point = olcs.core.ol4326CoordinateToCesiumCartesian(point);

  // Accurate computation of straight distance
  const radius = Cesium.Cartesian3.distance(center, point);
  const heightReference = this.getHeightReference(layer, feature, olGeometry);
  const heightInfo = this.getHeightInfo_(layer, feature);
  let minHeight = this.getMinHeightOrGroundlevel([olCenter], /** @type {number|undefined} */ (feature.get('olcs_groundLevel')));

  if (heightInfo) {
    minHeight -= heightInfo.skirt;
    fillGeometry = new Cesium.CircleGeometry({
      // always update Cesium externs before adding a property
      center,
      radius,
      extrudedHeight: minHeight + heightInfo.extrudedHeight,
      height: minHeight,
      vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
    });
  } else {
    fillGeometry = new Cesium.CircleGeometry({
      // always update Cesium externs before adding a property
      center,
      radius,
      height: minHeight,
      vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
    });
  }

  if (
    !heightInfo &&
    heightReference === Cesium.HeightReference.CLAMP_TO_GROUND &&
    Cesium.GroundPolylinePrimitive.isSupported(this.scene)
  ) {
    const width = this.extractLineWidthFromOlStyle(olStyle);
    if (width) {
      const circlePolygon = ol.geom.Polygon.circular(
        new ol.Sphere(6378137),
        olGeometry.getCenter(),
        radius
      );
      const positions = olcs.core.ol4326CoordinateArrayToCsCartesians(circlePolygon.getLinearRing(0).getCoordinates());
      outlinePrimitive = new Cesium.GroundPolylinePrimitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.GroundPolylineGeometry({ positions, width }),
        }),
        appearance: new Cesium.PolylineMaterialAppearance({
          material: this.olStyleToCesium(feature, olStyle, true),
        }),
        allowPicking: this.getAllowPicking(layer, feature, olGeometry),
        classificationType: Cesium.ClassificationType.TERRAIN,
      });
    }
  } else if (heightInfo) {
    outlineGeometry = new Cesium.CircleOutlineGeometry({
      // always update Cesium externs before adding a property
      center,
      radius,
      extrudedHeight: minHeight + heightInfo.extrudedHeight,
      height: minHeight,
      vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
    });
  } else {
    outlineGeometry = new Cesium.CircleOutlineGeometry({
      // always update Cesium externs before adding a property
      center,
      radius,
      height: minHeight,
      vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
    });
  }


  const primitives = this.wrapFillAndOutlineGeometries(
      layer, feature, olGeometry, fillGeometry, outlineGeometry, olStyle, heightInfo);

  if (outlinePrimitive) {
    this.setReferenceForPicking(layer, feature, outlinePrimitive);
    primitives.add(outlinePrimitive);
  }
  return this.addTextStyle(layer, feature, olGeometry, olStyle, primitives);
};



/**
 * Convert an OpenLayers line string geometry to Cesium.
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature OpenLayers feature..
 * @param {!ol.geom.LineString} olGeometry OpenLayers line string geometry.
 * @param {!ol.style.Style} olStyle
 * @param {olcs.HeightInfo|null} heightInfo
 * @return {!Cesium.PrimitiveCollection} primitives
 * @private
 */
olcs.FeatureConverter.prototype.olLineStringGeometryToCesiumWall_ = function(layer, feature, olGeometry, olStyle, heightInfo) {
  const coords = olGeometry.getCoordinates();
  let minimumHeight = this.getMinHeightOrGroundlevel(coords, heightInfo.groundLevel);

  const maximumHeight = minimumHeight + heightInfo.extrudedHeight;// maximumHeight has to be calculated before skirt correction is applied
  minimumHeight -= heightInfo.skirt;

  const positions = olcs.core.ol4326CoordinateArrayToCsCartesians(coords);
  const fillGeometry = Cesium.WallGeometry.fromConstantHeights({
    positions,
    maximumHeight,
    minimumHeight,
    vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
  });

  const outlineGeometry = Cesium.WallOutlineGeometry.fromConstantHeights({
    positions,
    maximumHeight,
    minimumHeight,
  });

  const primitives = this.wrapFillAndOutlineGeometries(layer, feature, olGeometry, fillGeometry, outlineGeometry, olStyle, heightInfo);
  return this.addTextStyle(layer, feature, olGeometry, olStyle, primitives);
};

/**
 * Convert an OpenLayers line string geometry to Cesium.
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature OpenLayers feature..
 * @param {!ol.geom.LineString} olGeometry OpenLayers line string geometry.
 * @param {!ol.ProjectionLike} projection
 * @param {!ol.style.Style} olStyle
 * @param {boolean=} noExtrusion - XXX fairly hacky, solution could be an internal function
 * @return {!Cesium.PrimitiveCollection} primitives
 * @api
 */
olcs.FeatureConverter.prototype.olLineStringGeometryToCesium = function(layer, feature, olGeometry, projection, olStyle, noExtrusion) {
  olGeometry = olcs.core.olGeometryCloneTo4326(olGeometry, projection);
  goog.asserts.assert(olGeometry.getType() == 'LineString');

  const allowPicking = this.getAllowPicking(layer, feature, olGeometry);
  const heightReference = this.getHeightReference(layer, feature, olGeometry);
  const heightInfo = this.getHeightInfo_(layer, feature);

  if (
    !noExtrusion &&
    heightInfo
  ) {
    return this.olLineStringGeometryToCesiumWall_(layer, feature, olGeometry, olStyle, heightInfo);
  }

  const positions = olcs.core.ol4326CoordinateArrayToCsCartesians(
      olGeometry.getCoordinates());

  const appearance = new Cesium.PolylineMaterialAppearance({
    // always update Cesium externs before adding a property
    material: this.olStyleToCesium(feature, olStyle, true)
  });

  const geometryOptions = {
    // always update Cesium externs before adding a property
    positions,
    width: this.extractLineWidthFromOlStyle(olStyle),
    vertexFormat: appearance.vertexFormat
  };

  let outlinePrimitive;
  const classificationType = this.getClassificationType(layer, feature);

  if (heightReference == Cesium.HeightReference.CLAMP_TO_GROUND) {
    if (Cesium.GroundPolylinePrimitive.isSupported(this.scene)) {
      outlinePrimitive = new Cesium.GroundPolylinePrimitive({
        // always update Cesium externs before adding a property
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.GroundPolylineGeometry(geometryOptions),
        }),
        classificationType: classificationType != null ? classificationType : this.classificationTypes_['terrain'],
        appearance,
        allowPicking,
      });
    } else {
      const color = this.extractColorFromOlStyle(olStyle, true);
      outlinePrimitive = new Cesium.GroundPrimitive({
        // always update Cesium externs before adding a property
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.CorridorGeometry(geometryOptions),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(color)
          }
        }),
        classificationType: classificationType != null ? classificationType : this.classificationTypes_['terrain'],
        allowPicking,
      });
    }
  } else if (Cesium.ClassificationPrimitive.isSupported(this.scene) && classificationType != null) {
    outlinePrimitive = new Cesium.ClassificationPrimitive({
      // always update Cesium externs before adding a property
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.PolylineGeometry(geometryOptions)
      }),
      appearance,
      allowPicking,
      classificationType,
    });
  } else {
    outlinePrimitive = new Cesium.Primitive({
      // always update Cesium externs before adding a property
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.PolylineGeometry(geometryOptions)
      }),
      appearance,
      allowPicking,
    });
  }

  this.setReferenceForPicking(layer, feature, outlinePrimitive);

  return this.addTextStyle(layer, feature, olGeometry, olStyle,
      outlinePrimitive);
};


/**
 * Convert an OpenLayers polygon geometry to Cesium.
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature OpenLayers feature..
 * @param {!ol.geom.Polygon} olGeometry OpenLayers polygon geometry.
 * @param {!ol.ProjectionLike} projection
 * @param {!ol.style.Style} olStyle
 * @return {!Cesium.PrimitiveCollection} primitives
 * @api
 */
olcs.FeatureConverter.prototype.olPolygonGeometryToCesium = function(layer, feature, olGeometry, projection, olStyle) {

  olGeometry = olcs.core.olGeometryCloneTo4326(olGeometry, projection);
  goog.asserts.assert(olGeometry.getType() == 'Polygon');

  let fillGeometry, outlineGeometry, outlinePrimitive;
    const rings = olGeometry.getLinearRings();
    // always update Cesium externs before adding a property
    const hierarchy = {};
    const polygonHierarchy = hierarchy;
    goog.asserts.assert(rings.length > 0);

    const heightInfo = this.getHeightInfo_(layer, feature);
    let minHeight = Infinity;

    for (let i = 0; i < rings.length; ++i) {
      const olPos = rings[i].getCoordinates();
      if (heightInfo) {
        minHeight = this.getMinHeightOrGroundlevel(olPos, heightInfo.groundLevel, minHeight);
      }
      const lastVertex = olPos[olPos.length - 1];
      if (!(
        olPos[0][0] === lastVertex[0] &&
        olPos[0][1] === lastVertex[1]
      )) {
        olPos.push(olPos[0]);
      }
      const positions = olcs.core.ol4326CoordinateArrayToCsCartesians(olPos);
      goog.asserts.assert(positions);
      if (i == 0) {
        hierarchy.positions = positions;
      } else {
        if (!hierarchy.holes) {
          hierarchy.holes = [];
        }
        hierarchy.holes.push({
          positions
        });
      }
    }
    let height;
    let perPositionHeight = true;
    if (heightInfo) {
      if (heightInfo.skirt) {
        height = minHeight - heightInfo.skirt;
        perPositionHeight = false;
      } else if (heightInfo.groundLevel) {
        height = heightInfo.groundLevel;
        perPositionHeight = false;
      }
    }

    if (heightInfo && heightInfo.storeyNumber) {
      height = height || minHeight;
      fillGeometry = [];
      outlineGeometry = [];
      perPositionHeight = false;

      const maxExtrudedHeight = minHeight + heightInfo.extrudedHeight;
      let extrudedHeight = minHeight + heightInfo.storeyHeight;

      for (let i = 0; i < heightInfo.storeyNumber; i++) {
        fillGeometry[i] = new Cesium.PolygonGeometry({
          // always update Cesium externs before adding a property
          polygonHierarchy,
          perPositionHeight,
          height,
          vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
          extrudedHeight,
        });
        outlineGeometry[i] = new Cesium.PolygonOutlineGeometry({
          // always update Cesium externs before adding a property
          polygonHierarchy,
          height,
          perPositionHeight,
          extrudedHeight,
          vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
        });
        extrudedHeight += heightInfo.storeyHeight;
        extrudedHeight = extrudedHeight > maxExtrudedHeight ? maxExtrudedHeight : extrudedHeight;
      }
    } else {
      fillGeometry = new Cesium.PolygonGeometry({
        // always update Cesium externs before adding a property
        polygonHierarchy,
        perPositionHeight,
        height,
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        extrudedHeight: heightInfo ? minHeight + heightInfo.extrudedHeight : undefined,
      });
    }
    if (
      !heightInfo &&
      this.getHeightReference(layer, feature, olGeometry) === Cesium.HeightReference.CLAMP_TO_GROUND &&
      Cesium.GroundPolylinePrimitive.isSupported(this.scene)
    ) {
      const width = this.extractLineWidthFromOlStyle(olStyle);
      if (width > 0) {
        const holesLength = hierarchy.holes ? hierarchy.holes.length : 0;
        const geometryInstances = new Array(holesLength + 1);
        geometryInstances[0] = new Cesium.GeometryInstance({
          geometry: new Cesium.GroundPolylineGeometry({ positions: hierarchy.positions, width }),
        });

        for (let i = 0; i < holesLength; i++) {
          geometryInstances[i + 1] = new Cesium.GeometryInstance({
            geometry: new Cesium.GroundPolylineGeometry({ positions: hierarchy.holes[i].positions, width }),
          });
        }

        outlinePrimitive = new Cesium.GroundPolylinePrimitive({
          geometryInstances,
          appearance: new Cesium.PolylineMaterialAppearance({
            material: this.olStyleToCesium(feature, olStyle, true)
          }),
          allowPicking: this.getAllowPicking(layer, feature, olGeometry),
          classificationType: Cesium.ClassificationType.TERRAIN,
        });
      }
    } else if (!outlineGeometry) {
      outlineGeometry = new Cesium.PolygonOutlineGeometry({
        // always update Cesium externs before adding a property
        polygonHierarchy: hierarchy,
        height,
        perPositionHeight,
        extrudedHeight: heightInfo ? minHeight + heightInfo.extrudedHeight : undefined,
        vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
      });
    }

  const primitives = this.wrapFillAndOutlineGeometries(
      layer, feature, olGeometry, fillGeometry, outlineGeometry, olStyle, heightInfo);

  if (outlinePrimitive) {
    this.setReferenceForPicking(layer, feature, outlinePrimitive);
    primitives.add(outlinePrimitive);
  }
  return this.addTextStyle(layer, feature, olGeometry, olStyle, primitives);
};

/**
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature
 * @return {olcs.HeightInfo|null}
 * @private
 */
olcs.FeatureConverter.prototype.getHeightInfo_ = function(layer, feature) {
  let extrudedHeight = /** @type {number} */ (feature.get('olcs_extrudedHeight'));
  let storeyNumber = /** @type {number} */ (feature.get('olcs_storeyNumber'));
  let storeyHeight = /** @type {number} */ (this.getDefaultFromLayer_('olcs_storeyHeight', layer, feature));

  if (extrudedHeight < 0) {
    storeyNumber = undefined;
    storeyHeight = undefined;
  } else if (extrudedHeight && storeyHeight) {
    storeyNumber = Math.ceil(extrudedHeight / storeyHeight);
  } else if (extrudedHeight && storeyNumber) {
    storeyHeight = extrudedHeight / storeyNumber;
  } else if (storeyHeight && storeyNumber) {
    extrudedHeight = storeyNumber * storeyHeight;
  }

  if (storeyNumber > 200) {
    storeyHeight = undefined;
    storeyNumber = undefined;
  }

  if (extrudedHeight) {
    const skirtProperty = Number(this.getDefaultFromLayer_('olcs_skirt', layer, feature));
    const skirt = Number.isFinite(skirtProperty) ? skirtProperty : 0;
    return {
      extrudedHeight,
      storeyNumber,
      storeyHeight,
      skirt,
      groundLevel: feature.get('olcs_groundLevel'),
    };
  }
  return null;
};

/**
 * returns the groundlevel or extracts the minimum Height from the coordinates, returns 0 if no Z coordinates are set
 * @param {Array.<ol.Coordinate>} coordinates
 * @param {number|null|undefined} groundLevel
 * @param {number=} minHeightInitial
 * @return {number}
 * @private
 */
olcs.FeatureConverter.prototype.getMinHeightOrGroundlevel = function(coordinates, groundLevel, minHeightInitial) {
  if (groundLevel != null && Number.isFinite(Number(groundLevel))) {
    return groundLevel;
  }
  let i = coordinates.length;
  let minimumHeight = minHeightInitial != null ? minHeightInitial : Infinity;
  while (i--) {
    minimumHeight = coordinates[i][2] && coordinates[i][2] < minimumHeight ? coordinates[i][2] : minimumHeight;
  }
  if (Number.isFinite(minimumHeight)) {
    return minimumHeight;
  }
  return 0;
};

/**
 * @param {string} propertyName
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {ol.Feature} feature
 * @return {*}
 * @private
 */
olcs.FeatureConverter.prototype.getDefaultFromLayer_ = function(propertyName, layer, feature) {
  return feature.get(propertyName) != null ? feature.get(propertyName) : layer.get(propertyName);
};

/**
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {ol.Feature} feature OpenLayers feature..
 * @param {!ol.geom.Geometry} geometry
 * @return {!boolean}
 * @api
 */
olcs.FeatureConverter.prototype.getAllowPicking = function(layer, feature, geometry) {

  let allowPicking = geometry.get('olcs_allowPicking');

  if (allowPicking === undefined) {
    allowPicking = feature.get('olcs_allowPicking');
  }

  if (allowPicking === undefined) {
    allowPicking = layer.get('olcs_allowPicking');
  }

  return allowPicking != null ? !!allowPicking : true;
};


/**
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {ol.Feature} feature OpenLayers feature..
 * @param {!ol.geom.Geometry} geometry
 * @return {!Cesium.HeightReference}
 * @api
 */
olcs.FeatureConverter.prototype.getHeightReference = function(layer, feature, geometry) {

  // Read from the geometry
  let altitudeMode = geometry.get('olcs_altitudeMode');

  // Or from the feature
  if (altitudeMode === undefined) {
    altitudeMode = feature.get('olcs_altitudeMode');
  }

  // Or from the layer
  if (altitudeMode === undefined) {
    altitudeMode = layer.get('olcs_altitudeMode');
  }

  let heightReference = Cesium.HeightReference.NONE;
  if (altitudeMode === 'clampToGround') {
    heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
  } else if (altitudeMode === 'relativeToGround') {
    // we only support RELATIVE_TO_GROUND for Point Geometries
    if (geometry.getType() === 'Point') {
      heightReference = Cesium.HeightReference.RELATIVE_TO_GROUND;
    } else {
      heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
    }
  }

  return heightReference;
};

/**
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {ol.Feature} feature OpenLayers feature..
 * @return {Cesium.ClassificationType|undefined}
 * @api
 */
olcs.FeatureConverter.prototype.getClassificationType = function(layer, feature) {
  let classificationType = feature.get('olcs_classificationType');
  if (!classificationType) {
    classificationType = layer.get('olcs_classificationType');
  }

  return typeof classificationType === 'string' ?
    this.classificationTypes_[classificationType] :
    undefined;
};

/**
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature OpenLayers feature..
 * @param {!ol.geom.Point} olGeometry OpenLayers point geometry.
 * @param {!ol.style.Style} style
 * @param {!number} minHeight
 * @return {!Cesium.PrimitiveCollection}
 * @private
 */
olcs.FeatureConverter.prototype.olPointGeometryToCesiumPin_ = function(layer, feature, olGeometry, style, minHeight) {
  const top = olGeometry.getCoordinates();
  const bottom = top.slice();
  bottom[2] = minHeight;
  const line = new ol.geom.LineString([top, bottom]);
  line.set('olcs_altitudeMode', 'absolute', false);

  return this.olLineStringGeometryToCesium(layer, feature, line, 'EPSG:4326', style, true);
};

/**
 * Convert a point geometry to a Cesium BillboardCollection.
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature OpenLayers feature..
 * @param {!ol.geom.Point} olGeometry OpenLayers point geometry.
 * @param {!ol.ProjectionLike} projection
 * @param {!ol.style.Style} style
 * @param {!Cesium.BillboardCollection} billboards
 * @param {function(!Cesium.Billboard)=} opt_newBillboardCallback Called when
 * the new billboard is added.
 * @return {Cesium.Primitive} primitives
 * @api
 */
olcs.FeatureConverter.prototype.olPointGeometryToCesium = function(layer, feature, olGeometry, projection, style, billboards,
    opt_newBillboardCallback) {
  goog.asserts.assert(olGeometry.getType() == 'Point');
  const usedGeometry = olcs.core.olGeometryCloneTo4326(olGeometry, projection);
  const heightInfo = this.getHeightInfo_(layer, feature);
  let minHeight;
  if (heightInfo) {
    minHeight = this.getMinHeightOrGroundlevel([olGeometry.getCoordinates()], heightInfo.groundLevel);
    const coords = usedGeometry.getCoordinates();
    coords[2] = minHeight + heightInfo.extrudedHeight;
    usedGeometry.setCoordinates(coords);
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
      const center = usedGeometry.getCoordinates();

      let color;
      const opacity = imageStyle.getOpacity();
      if (opacity !== undefined) {
        color = new Cesium.Color(1.0, 1.0, 1.0, opacity);
      }

      let zCoordinateEyeOffset = feature.get("olcs_zCoordinateEyeOffset");

      if (typeof zCoordinateEyeOffset != 'number') {
        /** number */
        zCoordinateEyeOffset = 0;
      }

      const altitudeMode = this.getHeightReference(layer, feature, olGeometry);
      let heightReference = altitudeMode;
      // if we have heightInfo, we always use absolute
      if (altitudeMode !== Cesium.HeightReference.NONE && heightInfo) {
        heightReference = Cesium.HeightReference.NONE;
      }

      // If heightAboveGround is set and heightreference is RelativeToGround, we use the given heightAboveground
      // as the Z Value, cesium will then update the height depending on the terrain
      if (heightReference === Cesium.HeightReference.RELATIVE_TO_GROUND) {
        const heightAboveGround = feature.get("olcs_heightAboveGround");
        if (typeof heightAboveGround == 'number') {
          center[2] = heightAboveGround;
        }
      }


      const position = olcs.core.ol4326CoordinateToCesiumCartesian(center);

      const bbOptions = /** @type {Cesium.optionsBillboardCollectionAdd} */ ({
        // always update Cesium externs before adding a property
        image,
        color,
        scale: imageStyle.getScale(),
        heightReference,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        position,
        id : feature.getId(),
        eyeOffset : new Cesium.Cartesian3(0,0, zCoordinateEyeOffset)
      });

      const anchor = imageStyle.getAnchor();
      const size = imageStyle.getSize();
      if (anchor && size) { // IE11 fix - loaded called before entire src is available
        bbOptions.pixelOffset = new Cesium.Cartesian2((size[0] / 2) - anchor[0], (size[1] / 2) - anchor[1]);
      }

      if (feature.get("olcs_scaleByDistance") && Array.isArray(feature.get("olcs_scaleByDistance") && feature.get("olcs_scaleByDistance").length === 4 )) {
        const array = feature.get("olcs_scaleByDistance");
        bbOptions.scaleByDistance = new Cesium.NearFarScalar(array[0], array[1], array[2], array[3]);
      }

      const bb = this.csAddBillboard(billboards, bbOptions, layer, feature,
        usedGeometry, style);
      if (opt_newBillboardCallback) {
        opt_newBillboardCallback(bb);
      }
    }).bind(this);

    if (image instanceof Image && !isImageLoaded(image)) {
      // Cesium requires the image to be loaded
      let cancelled = false;
      let source = layer.getSource();
      if (source instanceof ol.source.ImageVector) {
        source = source.getSource();
      }
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
        if (!billboards.isDestroyed() && !cancelled) {
          // Create billboard if the feature is still displayed on the map.
          reallyCreateBillboard();
        }
      };

      ol.events.listenOnce(image, 'load', listener);
    } else {
      reallyCreateBillboard();
    }
  }

  if (heightInfo) {
    minHeight = /** @type {number} */(minHeight - heightInfo.skirt);
    return this.olPointGeometryToCesiumPin_(layer, feature, usedGeometry, style, minHeight);
  } else  if (style.getText() && style.getText().getText()) {
    return this.addTextStyle(layer, feature, usedGeometry, style, new Cesium.Primitive());
  } else {
    return null;
  }
};


/**
 * Convert an OpenLayers multi-something geometry to Cesium.
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature OpenLayers feature..
 * @param {!ol.geom.Geometry} geometry OpenLayers geometry.
 * @param {!ol.ProjectionLike} projection
 * @param {!ol.style.Style} olStyle
 * @param {!Cesium.BillboardCollection} billboards
 * @param {function(!Cesium.Billboard)=} opt_newBillboardCallback Called when
 * the new billboard is added.
 * @return {Cesium.Primitive} primitives
 * @api
 */
olcs.FeatureConverter.prototype.olMultiGeometryToCesium = function(layer, feature, geometry, projection, olStyle, billboards,
    opt_newBillboardCallback) {
  // Do not reproject to 4326 now because it will be done later.

  // FIXME: would be better to combine all child geometries in one primitive
  // instead we create n primitives for simplicity.
  const accumulate = function(geometries, functor) {
    const primitives = new Cesium.PrimitiveCollection();
    geometries.forEach((geometry) => {
      primitives.add(functor(layer, feature, geometry, projection, olStyle));
    });
    return primitives;
  };

  let subgeos;
  switch (geometry.getType()) {
    case 'MultiPoint':
      geometry = /** @type {!ol.geom.MultiPoint} */ (geometry);
      subgeos = geometry.getPoints();
      if (olStyle.getText()) {
        const primitives = new Cesium.PrimitiveCollection();
        subgeos.forEach((geometry) => {
          goog.asserts.assert(geometry);
          const result = this.olPointGeometryToCesium(layer, feature, geometry,
              projection, olStyle, billboards, opt_newBillboardCallback);
          if (result) {
            primitives.add(result);
          }
        });
        return primitives;
      } else {
        subgeos.forEach((geometry) => {
          goog.asserts.assert(geometry);
          this.olPointGeometryToCesium(layer, feature, geometry, projection,
              olStyle, billboards, opt_newBillboardCallback);
        });
        return null;
      }
    case 'MultiLineString':
      geometry = /** @type {!ol.geom.MultiLineString} */ (geometry);
      subgeos = geometry.getLineStrings();
      return accumulate(subgeos, this.olLineStringGeometryToCesium.bind(this));
    case 'MultiPolygon':
      geometry = /** @type {!ol.geom.MultiPolygon} */ (geometry);
      subgeos = geometry.getPolygons();
      return accumulate(subgeos, this.olPolygonGeometryToCesium.bind(this));
    default:
      goog.asserts.fail(`Unhandled multi geometry type${geometry.getType()}`);
  }
};


/**
 * Convert an OpenLayers text style to Cesium.
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature OpenLayers feature..
 * @param {!ol.geom.Geometry} geometry
 * @param {!ol.style.Text} style
 * @return {Cesium.LabelCollection} Cesium primitive
 * @api
 */
olcs.FeatureConverter.prototype.olGeometry4326TextPartToCesium = function(layer, feature, geometry, style) {
  const text = style.getText();
  goog.asserts.assert(text !== undefined);


  const labels = new Cesium.LabelCollection({scene: this.scene});
  // TODO: export and use the text draw position from OpenLayers .
  // See src/ol/render/vector.js
  const extentCenter = ol.extent.getCenter(geometry.getExtent());
  if (geometry instanceof ol.geom.SimpleGeometry) {
    const first = geometry.getFirstCoordinate();
    extentCenter[2] = first.length == 3 ? first[2] : 0.0;
  }
  const options = /** @type {Cesium.optionsLabelCollection} */ ({});

  options.position = olcs.core.ol4326CoordinateToCesiumCartesian(extentCenter);

  options.text = text;

  options.heightReference = this.getHeightReference(layer, feature, geometry);

  const offsetX = style.getOffsetX() || 0;
  const offsetY = style.getOffsetY() || 0;
  options.pixelOffset = new Cesium.Cartesian2(offsetX, offsetY);

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

    const zCoordinateEyeOffset = feature.get("olcs_zCoordinateEyeOffset");
    if (typeof zCoordinateEyeOffset === 'number') {
      options.eyeOffset = new Cesium.Cartesian3(0,0, zCoordinateEyeOffset);
    }
  }


  const l = labels.add(options);
  this.setReferenceForPicking(layer, feature, l);
  return labels;
};


/**
 * Convert an OpenLayers style to a Cesium Material.
 * @param {ol.Feature} feature OpenLayers feature..
 * @param {!ol.style.Style} style
 * @param {boolean} outline
 * @return {Cesium.Material}
 * @api
 */
olcs.FeatureConverter.prototype.olStyleToCesium = function(feature, style, outline) {
  const fill = style.getFill();
  const stroke = style.getStroke();
  if ((outline && !stroke) || (!outline && !fill)) {
    return null; // FIXME use a default style? Developer error?
  }

  let color = outline ? stroke.getColor() : fill.getColor();
  color = olcs.core.convertColorToCesium(color);

  if (outline && stroke.getLineDash()) {
    return Cesium.Material.fromType('Stripe', {
      // always update Cesium externs before adding a property
      horizontal: false,
      repeat: 500, // TODO how to calculate this?
      evenColor: color,
      oddColor: new Cesium.Color(0, 0, 0, 0) // transparent
    });
  } else {
    return Cesium.Material.fromType('Color', {
      // always update Cesium externs before adding a property
      color
    });
  }

};


/**
 * Compute OpenLayers plain style.
 * Evaluates style function, blend arrays, get default style.
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature
 * @param {ol.StyleFunction|undefined} fallbackStyleFunction
 * @param {number} resolution
 * @return {ol.style.Style} null if no style is available
 * @api
 */
olcs.FeatureConverter.prototype.computePlainStyle = function(layer, feature, fallbackStyleFunction, resolution) {
  /**
   * @type {ol.FeatureStyleFunction|undefined}
   */
  const featureStyleFunction = feature.getStyleFunction();

  /**
   * @type {ol.style.Style|Array.<ol.style.Style>}
   */
  let style = null;

  if (featureStyleFunction) {
    style = featureStyleFunction.call(feature, resolution);
  }

  if (!style && fallbackStyleFunction) {
    style = fallbackStyleFunction(feature, resolution);
  }

  if (!style) {
    // The feature must not be displayed
    return null;
  }

  // FIXME combine materials as in cesium-materials-pack?
  // then this function must return a custom material
  // More simply, could blend the colors like described in
  // http://en.wikipedia.org/wiki/Alpha_compositing
  return Array.isArray(style) ? style[0] : style;
};


/**
 * Convert one OpenLayers feature up to a collection of Cesium primitives.
 * @param {ol.layer.Vector|ol.layer.Image} layer
 * @param {!ol.Feature} feature OpenLayers feature.
 * @param {!ol.style.Style} style
 * @param {!olcsx.core.OlFeatureToCesiumContext} context
 * @param {!ol.geom.Geometry=} opt_geom Geometry to be converted.
 * @return {Cesium.Primitive|Cesium.Entity} primitives
 * @api
 */
olcs.FeatureConverter.prototype.olFeatureToCesium = function(layer, feature, style, context, opt_geom) {
  let geom = opt_geom || feature.getGeometry();
  const proj = context.projection;
  if (!geom) {
    // OpenLayers features may not have a geometry
    // See http://geojson.org/geojson-spec.html#feature-objects
    return null;
  }

  const newBillboardAddedCallback = function(bb) {
    const mapped = /** @type {Array<Cesium.Billboard>} */ (context.featureToCesiumMap[ol.getUid(feature)]);
    if (mapped) {
      mapped.push(bb);
    } else {
      context.featureToCesiumMap[ol.getUid(feature)] = [bb];
    }
  };

  switch (geom.getType()) {
    case 'GeometryCollection':
      const primitives = new Cesium.PrimitiveCollection();
      const collection = /** @type {!ol.geom.GeometryCollection} */ (geom);
      // TODO: use getGeometriesArray() instead
      collection.getGeometries().forEach((geom) => {
        if (geom) {
          const prims = this.olFeatureToCesium(layer, feature, style, context,
              geom);
          if (prims) {
            primitives.add(/** @type {!Cesium.Primitive} */ (prims));
          }
        }
      });
      return primitives;
    case 'Point':
      geom = /** @type {!ol.geom.Point} */ (geom);
      const bbs = context.billboards;
      const result = this.olPointGeometryToCesium(layer, feature, geom, proj,
          style, bbs, newBillboardAddedCallback);
      if (!result) {
        // no wrapping primitive
        return null;
      } else {
        return result;
      }
    case 'Circle':
      geom = /** @type {!ol.geom.Circle} */ (geom);
      return this.olCircleGeometryToCesium(layer, feature, geom, proj,
          style);
    case 'LineString':
      geom = /** @type {!ol.geom.LineString} */ (geom);
      if (geom.getCoordinates().length < 2) {
        return null;
      }
      return this.olLineStringGeometryToCesium(layer, feature, geom, proj,
          style);
    case 'Polygon':
      geom = /** @type {!ol.geom.Polygon} */ (geom);
      if (geom.getCoordinates().some(c => c.length < 2)) {
        return null;
      }
      return this.olPolygonGeometryToCesium(layer, feature, geom, proj,
          style);
    case 'MultiPoint':
    case 'MultiLineString':
    case 'MultiPolygon':
      const result2 = this.olMultiGeometryToCesium(layer, feature, geom, proj,
          style, context.billboards, newBillboardAddedCallback);
      if (!result2) {
        // no wrapping primitive
        return null;
      } else {
        return result2;
      }
    case 'LinearRing':
      throw new Error('LinearRing should only be part of polygon.');
    default:
      throw new Error(`Ol geom type not handled : ${geom.getType()}`);
  }
};


/**
 * Convert an OpenLayers vector layer to Cesium primitive collection.
 * For each feature, the associated primitive will be stored in
 * `featurePrimitiveMap`.
 * @param {!(ol.layer.Vector|ol.layer.Image)} olLayer
 * @param {!ol.View} olView
 * @param {!Object.<number, !Cesium.Primitive>} featurePrimitiveMap
 * @return {!olcs.core.VectorLayerCounterpart|!olcs.core.ClusterLayerCounterpart}
 * @api
 */
olcs.FeatureConverter.prototype.olVectorLayerToCesium = function(olLayer, olView, featurePrimitiveMap) {
  const proj = olView.getProjection();
  const resolution = olView.getResolution();

  if (resolution === undefined || !proj) {
    goog.asserts.fail('View not ready');
    // an assertion is not enough for closure to assume resolution and proj
    // are defined
    throw new Error('View not ready');
  }

  let source = olLayer.getSource();
  if (olLayer instanceof ol.layer.Image) {
    if (source instanceof ol.source.ImageVector) {
      source = source.getSource();
    } else {
      // Not supported
      return new olcs.core.VectorLayerCounterpart(proj, this.scene);
    }
  }

  goog.asserts.assertInstanceof(source, ol.source.Vector);
  const features = source.getFeatures();
  const counterpart = new olcs.core.VectorLayerCounterpart(proj, this.scene);
  const context = counterpart.context;
  for (let i = 0; i < features.length; ++i) {
    const feature = features[i];
    if (!feature) {
      continue;
    }
    /**
     * @type {ol.StyleFunction|undefined}
     */
    let layerStyle;
    if (olLayer instanceof ol.layer.Image) {
      const imageSource = olLayer.getSource();
      goog.asserts.assertInstanceof(imageSource, ol.source.ImageVector);
      layerStyle = imageSource.getStyleFunction();
    } else {
      layerStyle = olLayer.getStyleFunction();
    }
    const style = this.computePlainStyle(olLayer, feature, layerStyle,
        resolution);
    if (!style) {
      // only 'render' features with a style
      continue;
    }
    const primitives = this.olFeatureToCesium(olLayer, feature, style, context);
    if (!primitives) {
      continue;
    }
    featurePrimitiveMap[ol.getUid(feature)] = /** @type {!Cesium.Primitive} */ (primitives);
    counterpart.getRootPrimitive().add(primitives);
  }

  return counterpart;
};


/**
 * Convert an OpenLayers feature to Cesium primitive collection.
 * @param {!(ol.layer.Vector|ol.layer.Image)} layer
 * @param {!ol.View} view
 * @param {!ol.Feature} feature
 * @param {!olcsx.core.OlFeatureToCesiumContext} context
 * @return {Cesium.Primitive|Cesium.Entity}
 * @api
 */
olcs.FeatureConverter.prototype.convert = function(layer, view, feature, context) {
  const proj = view.getProjection();
  const resolution = view.getResolution();

  if (resolution == undefined || !proj) {
    return null;
  }

  /**
   * @type {ol.StyleFunction|undefined}
   */
  let layerStyle;
  if (layer instanceof ol.layer.Image) {
    const imageSource = layer.getSource();
    if (imageSource instanceof ol.source.ImageVector) {
      layerStyle = imageSource.getStyleFunction();
    } else {
      return null;
    }
  } else {
    layerStyle = layer.getStyleFunction();
  }
  const style = this.computePlainStyle(layer, feature, layerStyle, resolution);

  if (!style) {
    // only 'render' features with a style
    return null;
  }

  context.projection = proj;
  return this.olFeatureToCesium(layer, feature, style, context);
};
