goog.provide('olcs.core.ClusterLayerCounterpart');

goog.require('ol');

goog.require('olcs.core.VectorLayerCounterpart');

/**
 * @param {!ol.proj.Projection|string} layerProjection
 * @param {!Cesium.Scene} scene
 * @param {ol.layer.Vector|ol.layer.Image} olLayer
 * @constructor
 * @api
 * @extends olcs.core.VectorLayerCounterpart
 */
olcs.core.ClusterLayerCounterpart = function (layerProjection, scene, olLayer) {
  olcs.core.VectorLayerCounterpart.call(this, layerProjection, scene);

  /**
   * @type {Cesium.CustomDataSource}
   * @private
   */
  this.dataSource_ = new Cesium.CustomDataSource(ol.getUid({}).ol_uid);
  this.dataSource_.clustering.enabled = false;
  this.dataSource_.clustering.minimumClusterSize = 2;

  const source = /** @type {!ol.source.Cluster} */ (olLayer.getSource());
  this.dataSource_.clustering.pixelRange = source.getDistance();

  /**
   * @type {Cesium.EntityCollection}
   */
  this.rootCollection_ = this.dataSource_.entities;
  this.context.entities = this.rootCollection_;
};
goog.inherits(olcs.core.ClusterLayerCounterpart, olcs.core.VectorLayerCounterpart);

/**
 * @api
 * @return {Cesium.CustomDataSource}
 */
olcs.core.ClusterLayerCounterpart.prototype.getDataSource = function() {
  return this.dataSource_;
};

/**
 * @api
 * @param {boolean} activate
 */
olcs.core.ClusterLayerCounterpart.prototype.setClustering = function(activate) {
  this.dataSource_.clustering.enabled = activate;
};
