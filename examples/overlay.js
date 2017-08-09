const url = "https://geodienste.hamburg.de/HH_WMS_Geobasisdaten_SW?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=false&t=175&zufall=0.8377870053429077&LAYERS=1%2C5%2C9%2C13&WIDTH=512&HEIGHT=512&CRS=EPSG%3A25832&STYLES=&BBOX=548463.9429414708%2C5939047.929774118%2C556591.9385523532%2C5947175.925385";
/*new ol.layer.Tile({
    extent: [897225.391044, 6898048.905789, 1350432.848029, 7379696.513570],
    source: new ol.source.TileWMS({
        url: 'https://geodienste.hamburg.de/HH_WMS_Geobasisdaten_SW',
        params: {'LAYERS': '1,5,9,13', 'TILED': true}
    })
})*/
const params = {
    'LAYERS': '1,5,9,13',
    'FORMAT': 'image/jpeg'
};
const sourceOptions = {
    url: "http://PC220/geodienstehamburgde/HH_WMS_Geobasisdaten_SW",
    params: params
};

const source = new ol.source.TileWMS(sourceOptions);
proj4.defs("EPSG:25832","+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs");

const projection = new ol.proj.Projection({
  code: 'EPSG:25832'
});
const ol2d = new ol.Map({
  layers: [
    new ol.layer.Tile({
      source: source
    })
  ],
  controls: ol.control.defaults({
    attributionOptions: /** @type {olx.control.AttributionOptions} */ ({
      collapsible: false
    })
  }),
  target: 'map',
  view: new ol.View({
    projection: projection,
    center: [560686.13, 5932584.13],
    zoom: 11
  })
});
const ol3d = new olcs.OLCesium({
  map: ol2d,
  target: 'map3d',
  createSynchronizers: function(map, scene){
      return [
          new olcs.WMSRasterSynchronizer(map, scene),
          new olcs.VectorSynchronizer(map, scene),
          new olcs.OverlaySynchronizer(map, scene)
      ];
  }

});
const scene = ol3d.getCesiumScene();
const terrainProvider = new Cesium.CesiumTerrainProvider({
  url: '//assets.agi.com/stk-terrain/world',
  requestVertexNormals: true
});
scene.terrainProvider = terrainProvider;

class OverlayHandler {
  constructor(ol2d, ol3d, scene) {
    this.ol2d = ol2d;
    this.ol3d = ol3d;
    this.scene = scene;

    this.staticOverlay = new ol.Overlay({
      element: document.getElementById('popup')
    });

    this.staticBootstrapPopup = new ol.Overlay({
      element: document.getElementById('popup-bootstrap')
    });
    this.ol2d.addOverlay(this.staticOverlay);
    this.ol2d.addOverlay(this.staticBootstrapPopup);

    this.options = {
      boostrap: false,
      add: true
    };

    this.ol2d.on('click', this.onClickHandlerOL.bind(this));
    const eventHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    eventHandler.setInputAction(this.onClickHandlerCS.bind(this), Cesium.ScreenSpaceEventType["LEFT_CLICK"]);

    const clickForm = document.getElementById('click-action-form');
    clickForm.onchange = function(event) {
      const checked = $('input[name="click-action"]:checked').val();
      this.options.add = checked === 'add';
    }.bind(this);

    const typeForm = document.getElementById('overlay-type-form');
    typeForm.onchange = function(event) {
      const checked = $('input[name="overlay-type"]:checked').val();
      this.options.boostrap = checked === 'popover';
    }.bind(this);
  }

  onClickHandlerOL(event) {
    const coordinates = event.coordinate;
    const hdms = ol.coordinate.toStringHDMS(
        ol.proj.transform(coordinates, 'EPSG:25832', 'EPSG:4326')
    );
    const overlay = this.getOverlay();
    this.setOverlayContent(overlay, hdms);
    overlay.setPosition(coordinates);
  }

  onClickHandlerCS(event) {
    if (event.position.x === 0 && event.position.y === 0){
      return;
    }

    const ray = this.scene.camera.getPickRay(event.position);
    const cartesian = this.scene.globe.pick(ray, scene);
    if (!cartesian) {
      return;
    }
    const cartographic = scene.globe.ellipsoid.cartesianToCartographic(cartesian);
    let coords = [Cesium.Math.toDegrees(cartographic.longitude), Cesium.Math.toDegrees(cartographic.latitude)];

    const height = scene.globe.getHeight(cartographic);
    if (height){
      coords = coords.concat([height]);
    }

    const transformedCoords = ol.proj.transform(coords, ol.proj.get("EPSG:4326"), 'EPSG:25832');
    const hdms = ol.coordinate.toStringHDMS(transformedCoords);
    const overlay = this.getOverlay();
    this.setOverlayContent(overlay, hdms);
    overlay.setPosition(transformedCoords);
  }

  getOverlay() {
    if (this.options.add) {
      return this.addOverlay();
    }

    if (this.options.boostrap) {
      return this.staticBootstrapPopup;
    }
    return this.staticOverlay;
  }

  setOverlayContent(overlay, hdms) {
    const element = overlay.getElement();
    if (this.options.boostrap) {
      const div = document.createElement('div');
      div.onclick = this.onCloseClick.bind(this, overlay, this.options.add);
      div.innerHTML = '<p>The location you clicked was:</p><code>' + hdms + '</code>';
      $(element).popover('destroy');
      $(element).popover({
        'placement': 'top',
        'animation': false,
        'html': true,
        'content': div
      });
      $(element).popover('show');
    } else {
      element.childNodes.forEach(function(child) {
        if (child.id === 'popup-content') {
          child.innerHTML = '<p>The location you clicked was:</p><code>' + hdms + '</code>';
          console.log(child);
        } else if (child.id === 'popup-closer') {
          child.onclick = this.onCloseClick.bind(this, overlay, this.options.add);
        }
      }, this);
    }
  }

  onCloseClick(overlay, add) {
    if (add) {
      this.ol2d.removeOverlay(overlay);
    } else {
      overlay.setPosition(null);
    }
  }

  addOverlay() {
    let element;
    if (this.options.boostrap) {
      element = document.getElementById('popup-bootstrap').cloneNode(true);
    } else {
      element = document.getElementById('popup').cloneNode(true)
    }
    const overlay = new ol.Overlay({ element });
    this.ol2d.addOverlay(overlay);
    return overlay;
  }
}

new OverlayHandler(ol2d, ol3d, scene);
// var content = document.getElementById('popup-content');
// var closer = document.getElementById('popup-closer');
// // var popup = new ol.Overlay({
// //   element: document.getElementById('popup'),
// //   autoPan: true,
// // });
// ol2d.addOverlay(popup);
//
// closer.onclick = function() {
//   popup.setPosition(undefined);
//   closer.blur();
//   return false;
// };
//
// var setPopup = function(evt) {
//     // var div = document.createElement("div");
//     // var element = popup.getElement();
//     var coordinate = evt.coordinate;
//     var hdms = ol.coordinate.toStringHDMS(ol.proj.transform(
//         coordinate, 'EPSG:25832', 'EPSG:4326'));
//     content.innerHTML = '<p>The location you clicked was:</p><code>' + hdms + '</code>';
//     // $(element).popover('destroy');
//     // if (popupActive) {
//     //   popupActive = false;
//     //   return;
//     // }
//     // $(element).popover({
//     //     'placement': 'top',
//     //     'animation': false,
//     //     'html': true,
//     //     'content': div
//     // });
//     // $(element).popover('show');
//     popup.setPosition(coordinate);
//     popupActive = true;
// };
// var addPopup = function(evt) {
//   var innerContainer = document.getElementById('popup').cloneNode(true);
//   innerContainer.id = '';
//   var innerPopup = new ol.Overlay({
//     autoPan: true,
//     positioning: 'bottom-center',
//     element: innerContainer
//   });
//   ol2d.addOverlay(innerPopup);
//
//   var coordinate = evt.coordinate;
//   innerPopup.setPosition(coordinate);
//   var hdms = ol.coordinate.toStringHDMS(ol.proj.transform(
//     coordinate, 'EPSG:25832', 'EPSG:4326'));
//   innerContainer.childNodes.forEach(function(child) {
//     if (child.id === 'popup-content') {
//       child.innerHTML = '<p>The location you clicked was:</p><code>' + hdms + '</code>';
//       console.log(child);
//     } else if (child.id === 'popup-closer') {
//       child.onclick = function() {
//         ol2d.removeOverlay(innerPopup);
//       };
//     }
//   });
// }
// ol2d.on('click', addPopup);

// var reactToClickEvent = function(event) {
//     if (event.position.x === 0 && event.position.y === 0){
//         // For some reason changing language in 2D generates a mouseup event in cesium with position (0,0)
//         // I cant find where this comes from..
//         return;
//     }
//
//     var ray = scene.camera.getPickRay(event.position);
//     var cartesian = scene.globe.pick(ray, scene);
//     var longitude;
//     var latitude;
//     var height;
//     var coords;
//     if (cartesian) {
//         var cartographic = scene.globe.ellipsoid.cartesianToCartographic(cartesian);
//         coords = [Cesium.Math.toDegrees(cartographic.longitude), Cesium.Math.toDegrees(cartographic.latitude)];
//
//         var height = scene.globe.getHeight(cartographic);
//         if(height){
//             coords = coords.concat([height]);
//         }
//     }
//
//
//     var feature = scene.pick(event.position);
//     if (feature instanceof Cesium.Cesium3DTileFeature) {
//         var object = {};
//         var propertyNames = feature.getPropertyNames();
//         var length = propertyNames.length;
//         for (var i = 0; i < length; ++i) {
//             var propertyName = propertyNames[i];
//             console.log(propertyName + ': ' + feature.getProperty(propertyName));
//             object[propertyName] = feature.getProperty(propertyName);
//         }
//         var pickedPosition = scene.pickPosition(event.position);
//         if (pickedPosition) {
//             var ellipsoid = scene.globe.ellipsoid;
//             var cartographicPP = ellipsoid.cartesianToCartographic(pickedPosition);
//             var coord = [Cesium.Math.toDegrees(cartographicPP.longitude), Cesium.Math.toDegrees(cartographicPP.latitude)];
//
//             var transformedCoords = ol.proj.transform(coord, ol.proj.get("EPSG:4326"), projection);
//             object.coords = transformedCoords.concat([cartographicPP.height]);
//         }
//     } else {
//         var transformedCoords = ol.proj.transform(coords, ol.proj.get("EPSG:4326"), projection);
//
//         addPopup({coordinate: transformedCoords});
//         //popup.setPosition(transformedCoords);
//         //Radio.trigger("Map", "clickedMAP", transformedCoords);
//     }
// }



