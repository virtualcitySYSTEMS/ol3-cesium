goog.provide('olcs.OverlaySynchronizer');

goog.require('olcs.Overlay');

goog.require('ol');
goog.require('ol.events');
goog.require('ol.proj');

/**
 * @param {!ol.Map} map
 * @param {!Cesium.Scene} scene
 * @constructor
 * @template T
 * @struct
 * @abstract
 * @api
 */
olcs.OverlaySynchronizer = function(map, scene) {
  /**
   * @type {!ol.Map}
   * @protected
   */
  this.map = map;

  /**
   * @type {ol.Collection.<ol.Overlay>}
   * @private
   */
  this.overlays = this.map.getOverlays();

  /**
   * @type {!Cesium.Scene}
   * @protected
   */
  this.scene = scene;

  /**
   * @private
   * @type {!Element}
   */
  this.overlayContainerStopEvent_ = document.createElement('DIV');
  this.overlayContainerStopEvent_.className = 'ol-overlaycontainer-stopevent';
  const overlayEvents = [
    ol.events.EventType.CLICK,
    ol.events.EventType.DBLCLICK,
    ol.events.EventType.MOUSEDOWN,
    ol.events.EventType.TOUCHSTART,
    ol.events.EventType.MSPOINTERDOWN,
    ol.MapBrowserEventType.POINTERDOWN,
    ol.events.EventType.MOUSEWHEEL,
    ol.events.EventType.WHEEL
  ];
  overlayEvents.forEach((event) => {
    ol.events.listen(this.overlayContainerStopEvent_, event, ol.events.Event.stopPropagation);
  });
  this.scene.canvas.parentElement.appendChild(this.overlayContainerStopEvent_);

  /**
   * @type {Object<string,olcs.Overlay>}
   * @private
   */
  this.overlayMap_ = {};
};



/**
 * Get the element that serves as a container for overlays that don't allow
 * event propagation. Elements added to this container won't let mousedown and
 * touchstart events through to the map, so clicks and gestures on an overlay
 * don't trigger any {@link ol.MapBrowserEvent}.
 * @return {!Element} The map's overlay container that stops events.
 */
olcs.OverlaySynchronizer.prototype.getOverlayContainerStopEvent = function() {
  return this.overlayContainerStopEvent_;
};

/**
 * Get the element that serves as a container for overlays that don't allow
 * event propagation. Elements added to this container won't let mousedown and
 * touchstart events through to the map, so clicks and gestures on an overlay
 * don't trigger any {@link ol.MapBrowserEvent}.
 * @return {!Element} The map's overlay container that stops events.
 */
olcs.OverlaySynchronizer.prototype.getOverlayContainer = function() {
  return this.overlayContainerStopEvent_;
};

/**
 * Destroy all and perform complete synchronization of the layers.
 * @api
 */
olcs.OverlaySynchronizer.prototype.synchronize = function() {
  this.destroyAll();
  this.addOverlays();
  this.overlays.on('add', this.addOverlayFromEvent_.bind(this));
  this.overlays.on('remove', this.removeOverlayerEvent_.bind(this));
};

/**
 * @param {ol.Collection.Event} event
 * @private
 */
olcs.OverlaySynchronizer.prototype.addOverlayFromEvent_ = function(event) {
  const overlay = /** @type {ol.Overlay} */ (event.element);
  this.addOverlay(overlay);
};

/**
 * @param {ol.Collection.Event} event
 * @private
 */
olcs.OverlaySynchronizer.prototype.removeOverlayerEvent_ = function(event) {
  const removedOverlay = /** @type {ol.Overlay} */ (event.element);
  const overlayId = ol.getUid(removedOverlay).toString();
  const csOverlay = this.overlayMap_[overlayId];
  if (csOverlay) {
    csOverlay.destroy();
  }
};
/**
 * @api
 */
olcs.OverlaySynchronizer.prototype.addOverlays = function() {
  this.overlays.forEach(this.addOverlay, this);
};

/**
 * @param {ol.Overlay} overlay
 * @api
 */
olcs.OverlaySynchronizer.prototype.addOverlay = function(overlay) {
  const cesiumOverlay = new olcs.Overlay({
    scene: this.scene,
    synchronizer: this,
    parent: overlay
  });

  cesiumOverlay.init();
  cesiumOverlay.handleMapChanged();
  const overlayId = ol.getUid(overlay).toString();
  this.overlayMap_[overlayId] = cesiumOverlay;
};

/**
 * Destroys all the created Cesium objects.
 * @protected
 */
olcs.OverlaySynchronizer.prototype.destroyAll = function() {

};


