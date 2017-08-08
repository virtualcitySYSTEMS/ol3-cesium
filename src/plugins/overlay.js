goog.provide('olcs.Overlay');

goog.require('ol');
goog.require('ol.dom');
goog.require('ol.Overlay');
goog.require('ol.Observable');

/**
 * @classdesc
 * An element to be displayed over the map and attached to a single map
 * location.  Like {@link ol.control.Control}, Overlays are visible widgets.
 * Unlike Controls, they are not in a fixed position on the screen, but are tied
 * to a geographical coordinate, so panning the map will move an Overlay but not
 * a Control.
 *
 * Example:
 *
 *     var popup = new olcs.Overlay({
 *       element: document.getElementById('popup')
 *     });
 *     popup.setPosition(coordinate);
 *     map.addOverlay(popup);
 *
 * @constructor
 * @extends {ol.Overlay}
 * @param {olx.OverlayOptions} options Overlay options.
 * @api
 */
olcs.Overlay = function(options) {
  ol.Overlay.call(this, options);
  /**
   * @private
   * @type {?Function}
   */
  this.scenePostRenderListenerRemover_ = null;

  /**
   * @type {Cesium.Scene}
   */
  this.scene = options.scene;

  /** @type {olcs.OverlaySynchronizer}*/
  this.synchronizer = options.synchronizer;

  /**
   * @private
   * @type {boolean}
   */
  this.insertFirst_ = options.insertFirst !== undefined ?
    options.insertFirst : true;

  /**
   * @private
   * @type {boolean}
   */
  this.stopEvent_ = options.stopEvent !== undefined ? options.stopEvent : true;

  /**
   * @type {MutationObserver|null}
   * @private
   */
  this.observer_ = null;

  /**
   * @private
   * @type {Element}
   * TODO I'm unsure if this works with the inherited functions
   */
  this.element_ = document.createElement('DIV');
  this.element_.className = `ol-overlay-container ${ol.css.CLASS_SELECTABLE}`;
  this.element_.style.position = 'absolute';

  this.autoPanMargin_ = options['autoPanMargin_'];

  /**
   * @private
   * @type {ol.Overlay}
   */
  this.parent_ = options['parent'];
  /** @type {Array<number>} */
  this.listenerKeys_ = [];
  if (this.parent_) {
    const target = this.parent_.getElement().parentNode;
    this.observer_ = new MutationObserver(this.changeElement_.bind(this));
    this.observer_.observe(target, {
      attributes: false,
      childList: true,
      characterData: false,
      subtree: true
    });
    this.listenerKeys_.push(this.parent_.on('change:position', this.changePosition_.bind(this)));
    this.listenerKeys_.push(this.parent_.on('change:element', this.changeElement_.bind(this)));
  }
};
ol.inherits(olcs.Overlay, ol.Overlay);

/**
 * Get the scene associated with this overlay.
 * @see ol.Overlay.prototype.getMap
 * @return {Cesium.Scene|undefined} The map that the overlay is part of.
 * @observable
 * @api
 */
olcs.Overlay.prototype.getScene = function() {
  return this.scene;
};

// /**
//  * @protected
//  */
// olcs.Overlay.prototype.handleElementChanged = function() { // NOTE this is setElement in overlaysynchronizer
//   ol.dom.removeChildren(this.element_);
//   var element = this.getElement();
//   if (element) {
//     this.element_.appendChild(element);
//   }
// };


/**
 * @api
 */
olcs.Overlay.prototype.handleMapChanged = function() {
  if (this.scenePostRenderListenerRemover_) {
    this.scenePostRenderListenerRemover_();
  }
  this.scenePostRenderListenerRemover_ = null;

  const scene = this.getScene();
  if (scene) {
    this.scenePostRenderListenerRemover_ = scene.postRender.addEventListener(this.render.bind(this));
    this.updatePixelPosition();
    const container = this.stopEvent_ ?
      this.synchronizer.getOverlayContainerStopEvent() : this.synchronizer.getOverlayContainer(); // TODO respect stop-event flag in synchronizer
    if (this.insertFirst_) {
      container.insertBefore(this.element_, container.childNodes[0] || null);
    } else {
      container.appendChild(this.element_);
    }
  }
};

/**
 * @protected
 * @todo potentially we don't need this at all
 */
olcs.Overlay.prototype.handlePositionChanged = function() {
  this.updatePixelPosition();
  // if (this.getPosition() && this.autoPan) {
  //   this.panIntoView_();
  // }
};

olcs.Overlay.prototype.panIntoView_ = function() {
  const position = this.getPosition();
  let cartesian;
  if (position.length === 2) {
    cartesian = Cesium.Cartesian3.fromDegreesArray(position)[0];
  } else {
    cartesian = Cesium.Cartesian3.fromDegreesArrayHeights(position)[0];
  }

  const pixelCartesian = this.scene.cartesianToCanvasCoordinates(cartesian);
  const element = this.element_;
  const overlayRect = this.getRect_(element,
    [ol.dom.outerWidth(element), ol.dom.outerHeight(element)]);


  console.log(pixelCartesian, overlayRect);
};

olcs.Overlay.prototype.getRect_ = function(element, size) {
  const box = element.getBoundingClientRect();
  const offsetX = box.left + window.pageXOffset;
  const offsetY = box.top + window.pageYOffset;
  return [
    offsetX,
    offsetY,
    offsetX + size[0],
    offsetY + size[1]
  ];
};

olcs.Overlay.prototype.init = function() {
  this.changePosition_();
  this.changeElement_();
};
/**
 * @private
 */
olcs.Overlay.prototype.changePosition_ = function() {
  const position = this.parent_.getPosition();

  if (position) {
    this.element_.style.display = '';
    const sourceProjection = this.parent_.getMap().getView().getProjection();
    const coords = ol.proj.transform(position, sourceProjection, 'EPSG:4326');
    this.setPosition(coords);
    this.handleMapChanged();
  } else {
    this.element_.style.display = 'none';
  }
};

/**
 * @private
 */
olcs.Overlay.prototype.changeElement_ = function() {
  function cloneNode(node, parent) {
    const clone = node.cloneNode();
    if (parent) {
      parent.appendChild(clone);
    }
    if (node.nodeType != Node.TEXT_NODE) {
      clone.addEventListener('click', function(event) {
        node.dispatchEvent(new MouseEvent('click', event));
        event.stopPropagation();
      });
    }
    const nodes = node.childNodes;
    for (let i = 0; i < nodes.length; i++) {
      if (!nodes[i]) {
        continue;
      }
      cloneNode(nodes[i], clone);
    }
    return clone;
  }

  if (this.parent_.getElement()) {
    const clonedNode = cloneNode(this.parent_.getElement(), null);

    this.setElement(clonedNode);
    const parentNode = this.getElement().parentNode;
    while (parentNode.firstChild) {
      parentNode.removeChild(parentNode.firstChild);
    }
    const childNodes = this.parent_.getElement().parentNode.childNodes;
    for (let i = 0; i < childNodes.length; i++) {
      cloneNode(childNodes[i], parentNode);
    }
  }
};

/**
 * Update pixel position.
 * @protected
 */
olcs.Overlay.prototype.updatePixelPosition = function() {
  const scene = this.getScene();
  const position = this.getPosition();
  if (!scene || !position) {
    this.setVisible(false);
    return;
  }
  let cartesian;
  if (position.length === 2) {
    cartesian = Cesium.Cartesian3.fromDegreesArray(position)[0];
  } else {
    cartesian = Cesium.Cartesian3.fromDegreesArrayHeights(position)[0];
  }

  const pixelCartesian = scene.cartesianToCanvasCoordinates(cartesian);
  const pixel = [pixelCartesian.x, pixelCartesian.y];
  const mapSize = [scene.canvas.width, scene.canvas.height];
  this.updateRenderedPosition(pixel, mapSize);
};

olcs.Overlay.prototype.destroy = function() {
  if (this.observer_) {
    this.observer_.disconnect();
    this.observer_ = null;
  }
  this.listenerKeys_.forEach(ol.Observable.unByKey);
  this.listenerKeys_.splice(0);
  if (this.element_.removeNode) {
    this.element_.removeNode(true);
  } else {
    this.element_.remove();
  }
};
