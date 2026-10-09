// שכבת GIS מהעצים: GeoJSON (ל-QGIS / ArcGIS) ו-KML (לגוגל ארת' / מפות)
(function (root) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function rows(surveys) {
    const out = [];
    for (const s of surveys) for (const t of Core.sortTrees(s.trees)) {
      if (t.lat == null || !Core.hasContent(t)) continue;
      out.push({ s, t, props: {
        project: s.project || '', site: s.site || '', code: s.code || '', date: s.date || '',
        tree_no: String(t.num || ''), species: t.species || '', notes: t.notes || '', urgency: t.urgency || '',
        pines: t.pines == null || t.pines === '' ? null : Number(t.pines), pine: Core.isPine(t.species),
        photos: (t.photos || []).length, accuracy_m: t.acc == null ? null : Math.round(t.acc),
        gps_time: t.gpsTime ? new Date(t.gpsTime).toISOString() : null,
      } });
    }
    return out;
  }

  const Gis = {
    geojson(surveys) {
      return JSON.stringify({ type: 'FeatureCollection', features: rows(surveys).map(({ t, props }) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [+t.lon.toFixed(7), +t.lat.toFixed(7)] }, properties: props,
      })) }, null, 1);
    },
    kml(surveys, name) {
      const marks = rows(surveys).map(({ t, props }) =>
        `<Placemark><name>${esc('עץ ' + props.tree_no + ' ' + props.species)}</name>` +
        `<description>${esc([props.site, props.notes, props.urgency ? 'דחיפות ' + props.urgency : ''].filter(Boolean).join('\n'))}</description>` +
        `<ExtendedData>${Object.entries(props).map(([k, v]) => `<Data name="${k}"><value>${esc(v)}</value></Data>`).join('')}</ExtendedData>` +
        `<Point><coordinates>${t.lon.toFixed(7)},${t.lat.toFixed(7)},0</coordinates></Point></Placemark>`).join('\n');
      return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name || 'סקר עצים')}</name>\n${marks}\n</Document></kml>`;
    },
  };
  root.Gis = Gis;
})(self);
