goog.provide('olcs.core.ClusterLayerCounterpart');
goog.require('olcs.core.VectorLayerCounterpart');

olcs.core.ClusterLayerCounterpart = function (layerProjection, scene, olLayer) {
  goog.base(this, layerProjection, scene);
  this.dataSource_ = new Cesium.CustomDataSource(ol.getUid({}).ol_uid);
  this.dataSource_.clustering.enabled = true;
  this.dataSource_.clustering.minimumClusterSize = 2;
  this.dataSource_.clustering.pixelRange = olLayer.getSource().getDistance();
  this.rootCollection_ = this.dataSource_.entities;
  this.context.entities = this.rootCollection_;
};
goog.inherits(olcs.core.ClusterLayerCounterpart, olcs.core.VectorLayerCounterpart);

olcs.core.ClusterLayerCounterpart.prototype.getDataSource = function() {
  return this.dataSource_;
};
