import { describe, expect, it, vi } from 'vitest';
import {
  createPointFeatureQuery,
  featureLayerFields,
  normalizeFlightMetadata,
  queryPointFeatureLayer,
} from './identifyFeatures';

describe('featureLayerFields', () => {
  it('uses the state administration category and flight metadata fields exposed by the new services', () => {
    expect(featureLayerFields.landOwnership).toEqual(['st_sym']);
    expect(featureLayerFields.imageryDate).toEqual(['DATE', 'RESOLUTION']);
  });
});

describe('createPointFeatureQuery', () => {
  it('queries polygons intersecting the input point and requests only needed fields', () => {
    const point = { type: 'point', x: -12442000, y: 4976000 };

    expect(createPointFeatureQuery(point, ['NAME'])).toEqual({
      geometry: point,
      spatialRelationship: 'intersects',
      outFields: ['NAME'],
      returnGeometry: false,
    });
  });
});

describe('normalizeFlightMetadata', () => {
  const dateFormatter = { format: (date) => `formatted ${date.getTime()}` };

  it('formats a single date returned as a FeatureServer timestamp', () => {
    expect(normalizeFlightMetadata({ date: 1792137600000, resolution: '6 inch' }, dateFormatter)).toEqual({
      date: 'formatted 1792137600000',
      resolution: '6 inch',
    });
  });

  it('selects the newest flight date when the point intersects multiple hexagons', () => {
    expect(
      normalizeFlightMetadata(
        [
          { attributes: { date: 1792137600000, resolution: '6 inch' } },
          { attributes: { date: 1823673600000, resolution: '3 inch' } },
        ],
        dateFormatter,
      ),
    ).toEqual({ date: 'formatted 1823673600000', resolution: '3 inch' });
  });
});

describe('queryPointFeatureLayer', () => {
  it('passes the query and abort signal to the feature layer and normalizes field names', async () => {
    const point = { type: 'point', x: -12442000, y: 4976000 };
    const signal = new AbortController().signal;
    const layer = {
      queryFeatures: vi.fn().mockResolvedValue({
        features: [{ attributes: { NAME: 'SALT LAKE', ZIP5: '84101' } }],
      }),
    };

    await expect(
      queryPointFeatureLayer({ layer, geometry: point, outFields: ['NAME', 'ZIP5'], signal }),
    ).resolves.toEqual([{ attributes: { name: 'SALT LAKE', zip5: '84101' } }]);

    expect(layer.queryFeatures).toHaveBeenCalledWith(
      {
        geometry: point,
        spatialRelationship: 'intersects',
        outFields: ['NAME', 'ZIP5'],
        returnGeometry: false,
      },
      { signal },
    );
  });

  it('returns an empty result when the point does not intersect a feature', async () => {
    const layer = { queryFeatures: vi.fn().mockResolvedValue({ features: [] }) };

    await expect(queryPointFeatureLayer({ layer, geometry: {}, outFields: ['NAME'] })).resolves.toEqual([]);
  });

  it('propagates aborted queries so the caller can ignore stale results', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const layer = { queryFeatures: vi.fn().mockRejectedValue(abortError) };

    await expect(queryPointFeatureLayer({ layer, geometry: {}, outFields: ['NAME'] })).rejects.toBe(abortError);
  });
});
