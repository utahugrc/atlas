export const featureLayerFields = {
  counties: ['NAME'],
  municipalities: ['NAME'],
  // The Agency schema's State Symbology field replaces the former STATE_LGD field.
  landOwnership: ['st_sym'],
  nationalGrid: ['USNG'],
  zip: ['ZIP5'],
  imageryDate: ['DATE', 'RESOLUTION'],
};

export const normalizeFlightMetadata = (data, dateFormatter) => {
  const records = Array.isArray(data) ? data.map(({ attributes }) => attributes ?? {}) : data ? [data] : [];
  const dates = records
    .filter(({ date }) => date !== undefined && date !== null && date !== '')
    .map(({ date, resolution }) => ({ date: new Date(date), resolution }))
    .filter(({ date }) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.date - b.date);
  const newest = dates[dates.length - 1];

  return newest ? { ...newest, date: dateFormatter.format(newest.date) } : null;
};

export const createPointFeatureQuery = (geometry, outFields) => ({
  geometry,
  spatialRelationship: 'intersects',
  outFields,
  returnGeometry: false,
});

export const queryPointFeatureLayer = async ({ layer, geometry, outFields, signal }) => {
  const { features } = await layer.queryFeatures(createPointFeatureQuery(geometry, outFields), { signal });

  return features.map(({ attributes }) => ({
    attributes: Object.fromEntries(
      Object.entries(attributes ?? {}).map(([field, value]) => [field.toLowerCase(), value]),
    ),
  }));
};
