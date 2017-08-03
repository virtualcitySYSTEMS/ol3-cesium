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
     *
     * @type {ol.Collection.<ol.Overlay>}
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
    var overlayEvents = [
        ol.events.EventType.CLICK,
        ol.events.EventType.DBLCLICK,
        ol.events.EventType.MOUSEDOWN,
        ol.events.EventType.TOUCHSTART,
        ol.events.EventType.MSPOINTERDOWN,
        ol.MapBrowserEventType.POINTERDOWN,
        ol.events.EventType.MOUSEWHEEL,
        ol.events.EventType.WHEEL
    ];
    for (var i = 0, ii = overlayEvents.length; i < ii; ++i) {
        ol.events.listen(this.overlayContainerStopEvent_, overlayEvents[i], ol.events.Event.stopPropagation);
    }
    this.scene.canvas.parentElement.appendChild(this.overlayContainerStopEvent_);
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
  this.overlays.on('add', this.addOverlayFromEvent.bind(this));



};


/**
 * @api
 */
olcs.OverlaySynchronizer.prototype.addOverlays = function() {
    this.overlays.forEach(function(overlay) {
        this.addOverlay(overlay);
    }.bind(this));
};

/**
 * @api
 */
olcs.OverlaySynchronizer.prototype.addOverlayFromEvent = function(event) {
    var overlay = event.element;
    this.addOverlay(overlay);
};
/**
 * @api
 */
olcs.OverlaySynchronizer.prototype.addOverlay = function(overlay) {
    var cesiumOverlay = new olcs.Overlay({
        scene: this.scene,
        synchronizer: this,
        element: overlay.element
    });
    overlay.on('change:position', this.setPosition.bind(this, cesiumOverlay, overlay));
    var target = overlay.getElement().parentNode;
    var observer = new MutationObserver(this.setElement.bind(this, cesiumOverlay, overlay));
    observer.observe(target, {
        attributes: false,
        childList: true,
        characterData: false,
        subtree:true
    });
    overlay.on('change:element', this.setElement.bind(this, cesiumOverlay, overlay));

    this.setPosition(cesiumOverlay, overlay);
    this.setElement(cesiumOverlay, overlay);
    cesiumOverlay.handleMapChanged();
};

olcs.OverlaySynchronizer.prototype.setPosition= function(cesiumOverlay,overlay){
    if(overlay.getPosition()) {
        var coords = ol.proj.transform(overlay.getPosition(), 'EPSG:25832', 'EPSG:4326');
        cesiumOverlay.setPosition(coords);
        cesiumOverlay.handleMapChanged();
    }

};
olcs.OverlaySynchronizer.prototype.setElement= function(cesiumOverlay,overlay){
    if(overlay.getElement()) {
        function cloneNode(node, parent) {
            var clone = node.cloneNode();
            if(parent){
                parent.appendChild(clone);
            }
            if(node.nodeType != Node.TEXT_NODE){
                clone.addEventListener('click', function(event){
                   node.dispatchEvent(new MouseEvent('click', event));
                   event.stopPropagation();
                });
            }
            // do some thing with the node here
            var nodes = node.childNodes;
            for (var i = 0; i < nodes.length; i++) {
                if (!nodes[i]) {
                    continue;
                }

                //if (nodes[i].childNodes.length > 0) {
                    cloneNode(nodes[i], clone);
                //}
            }
            return clone
        }
        var clonedNode = cloneNode(overlay.getElement(), null);
        /*var ni = document.createNodeIterator(overlay.getElement().parentNode, NodeFilter.SHOW_ELEMENT);


        while(currentNode = ni.nextNode()) {
            console.log(currentNode.nodeName);
        }*/
        // var test = overlay.getElement().parentNode.cloneNode(true)
        cesiumOverlay.setElement(clonedNode);
        var parentNode = cesiumOverlay.getElement().parentNode
        while (parentNode.firstChild) {
            parentNode.removeChild(parentNode.firstChild);
        }
        var childNodes = overlay.getElement().parentNode.childNodes;
        for (var i = 0; i < childNodes.length; i++) {
            cloneNode(childNodes[i], parentNode)
        }
    }
};






/**
 * Destroys all the created Cesium objects.
 * @protected
 */
olcs.OverlaySynchronizer.prototype.destroyAll = function() {

};


