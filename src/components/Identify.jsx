import FeatureLayer from '@arcgis/core/layers/FeatureLayer.js';
import { isLoaded, load, execute as project } from '@arcgis/core/geometry/operators/projectOperator.js';
import { ExternalLink } from '@ugrc/utah-design-system/components/Link';
import { toQueryString } from '@ugrc/utilities/url';
import startCase from 'lodash.startcase';
import PropTypes from 'prop-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text } from 'react-aria-components';
import { fetchElevation } from './elevation';
import { featureLayerFields, normalizeFlightMetadata, queryPointFeatureLayer } from './identifyFeatures';

const featureLayerUrls = {
  counties:
    'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/UtahCountyBoundaries/FeatureServer/0',
  municipalities:
    'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/UtahMunicipalBoundaries/FeatureServer/0',
  landOwnership:
    'https://gis.trustlands.utah.gov/mapping/rest/services/Land_Ownership_Agency_Web_Mercator/FeatureServer/0',
  nationalGrid: 'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/NationalGrid/FeatureServer/0',
  zip: 'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/UtahZipCodeAreas/FeatureServer/0',
  imageryDate:
    'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/Utah_Hexagon_Service_Dates/FeatureServer/0',
};

const fieldNames = {
  // counties & municipalities
  NAME: 'name',
  // land ownership
  STATE_SYM: 'st_sym',
  USNG: 'usng',
  ZIP5: 'zip5',
};

const urls = {
  reverse: 'https://api.mapserv.utah.gov/api/v1/geocode/reverse',
  google: 'https://www.google.com/maps?q&layer=c&',
};

const intl = new Intl.DateTimeFormat('en-US', { dateStyle: 'short' });
const outside = 'Outside of Utah';
const loading = 'loading...';
const loadingElevation = { meters: loading, feet: loading };
const loadingFlightDate = { loading: true, date: null, resolution: null };

const projectPoint = async (mapPoint, srid) => {
  // lat/long coords
  if (!isLoaded()) {
    await load();
  }

  return project(mapPoint, { wkid: srid });
};

export const IdentifyInformation = ({ apiKey, wkid = 3857, location }) => {
  const [spatial, setSpatial] = useState({
    x: 0,
    y: 0,
    lat: 0,
    lon: 0,
    googleMapsLink: '',
  });
  const [address, setAddress] = useState(loading);
  const [ownership, setOwnership] = useState(loading);
  const [county, setCounty] = useState(loading);
  const [grid, setGrid] = useState(loading);
  const [zip, setZip] = useState(loading);
  const [city, setCity] = useState(loading);
  const [elevation, setElevation] = useState(loadingElevation);
  const [flightDate, setFlightDate] = useState(loadingFlightDate);
  const signal = useRef();
  const controller = useRef();

  const featureLayers = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(featureLayerUrls).map(([name, url]) => [name, new FeatureLayer({ url })]),
      ),
    [],
  );

  const requests = useMemo(
    () => [
      [
        featureLayers.counties,
        featureLayerFields.counties,
        (data) => {
          if (!data) {
            setCounty(outside);

            return;
          }
          setCounty(data[fieldNames.NAME]);
        },
      ],
      [
        featureLayers.municipalities,
        featureLayerFields.municipalities,
        (data) => {
          if (!data) {
            setCity('Unincorporated');

            return;
          }
          setCity(data[fieldNames.NAME]);
        },
      ],
      [
        featureLayers.landOwnership,
        featureLayerFields.landOwnership,
        (data) => {
          if (!data) {
            setOwnership(outside);

            return;
          }
          setOwnership(data[fieldNames.STATE_SYM]);
        },
      ],
      [
        featureLayers.nationalGrid,
        featureLayerFields.nationalGrid,
        (data) => {
          if (!data) {
            setGrid(outside);

            return;
          }

          setGrid(data[fieldNames.USNG]);
        },
      ],
      [
        featureLayers.zip,
        featureLayerFields.zip,
        (data) => {
          if (!data) {
            setZip(outside);

            return;
          }

          setZip(data[fieldNames.ZIP5]);
        },
      ],
      [
        featureLayers.imageryDate,
        featureLayerFields.imageryDate,
        (data) => {
          if (!data) {
            setFlightDate({ date: 'unknown', resolution: 'A mystery' });

            return;
          }

          setFlightDate(normalizeFlightMetadata(data, intl));
        },
      ],
    ],
    [featureLayers],
  );

  const reverseGeocode = useCallback(
    async (point, requestSignal) => {
      const distanceInMeters = 50;
      const url = `${urls.reverse}/${point.x}/${point.y}/?`;
      const query = toQueryString({
        apiKey: apiKey,
        distance: distanceInMeters,
        spatialReference: wkid,
      });

      try {
        const response = await fetch(url + query, { signal: requestSignal });
        let result = await response.json();
        let address = 'No house address found.';

        if (response.status === 200 && result.status === 200 && result.result.address) {
          address = result.result.address.street;
        }

        setAddress(address);
      } catch (ex) {
        if (ex.name === 'AbortError') {
          return;
        }

        console.warn(ex);
      }
    },
    [wkid, apiKey],
  );

  const getElevation = useCallback(
    async (mapPoint, requestSignal) => {
      try {
        const data = await fetchElevation({
          mapPoint,
          signal: requestSignal,
          wkid,
        });

        setElevation(data ?? { feet: outside, meters: outside });
      } catch (error) {
        if (error.name === 'AbortError') {
          return;
        }

        console.warn(error);
        setElevation({ feet: outside, meters: outside });
      }
    },
    [wkid],
  );

  const get = useCallback(
    async (requestMetadata, mapPoint, requestSignal) => {
      await Promise.all(
        requestMetadata.map(async ([layer, outFields, onResult]) => {
          try {
            const result = await queryPointFeatureLayer({
              layer,
              geometry: mapPoint,
              outFields,
              signal: requestSignal,
            });
            let data;

            if (result.length === 1) {
              data = result[0].attributes || {};
            }

            if (result.length > 1) {
              console.warn('more than one result found', layer.url);
              data = result;
            }

            onResult(data);
          } catch (error) {
            if (error.name === 'AbortError') {
              return;
            }

            console.warn(error);
          }
        }),
      );

      await reverseGeocode(mapPoint, requestSignal);
    },
    [reverseGeocode],
  );

  useEffect(() => {
    const identify = async () => {
      setSpatial({
        x: 0,
        y: 0,
        lat: 0,
        lon: 0,
      });
      setAddress(loading);
      setZip(loading);
      setOwnership(loading);
      setCity(loading);
      setCounty(loading);
      setGrid(loading);
      setElevation(loadingElevation);
      setFlightDate(loadingFlightDate);

      const requestSignal = signal.current;

      await Promise.all([get(requests, location, requestSignal), getElevation(location, requestSignal)]);

      if (requestSignal.aborted) {
        return;
      }

      const ll = await projectPoint(location, 4326);
      const utm = await projectPoint(location, 26912);

      const decimalPlaces = 100000;
      const lat = Math.round(ll.x * decimalPlaces) / decimalPlaces;
      const lon = Math.round(ll.y * decimalPlaces) / decimalPlaces;

      const x = Math.round(utm.x * 100) / 100;
      const y = Math.round(utm.y * 100) / 100;

      setSpatial({
        x,
        y,
        lat,
        lon,
        googleMapsLink: `${urls.google}cbll=${lon},${lat}`,
      });
    };

    controller.current?.abort();
    controller.current = new AbortController();
    signal.current = controller.current.signal;

    if (location) {
      identify();
    }

    return () => controller.current?.abort();
  }, [location, get, getElevation, requests]);

  if (!location) {
    return (
      <p>
        First, explore the map to find your desired location. Then, click on it to reveal additional details about the
        area.
      </p>
    );
  }

  return (
    <div className="mx-auto grid grid-cols-2 gap-10 lg:grid-cols-5 lg:gap-4">
      <div
        className="flex flex-col gap-1 rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800"
        role="presentation"
      >
        <div className="w-fit cursor-default text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Approximate Street Address
        </div>
        <Text className="block pl-1 text-sm">
          <Text className="block pl-1 text-sm">{address}</Text>
          <ExternalLink href={spatial.googleMapsLink} className="pl-1">
            Google Street View
          </ExternalLink>
        </Text>
        <Text className="block grow content-end text-xs">
          Provided by{' '}
          <ExternalLink href="https://gis.utah.gov/products/sgid/transportation/road-centerlines/">roads</ExternalLink>
        </Text>
      </div>
      <div
        className="flex flex-col gap-1 rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800"
        role="presentation"
      >
        <div className="w-fit cursor-default text-sm font-medium text-zinc-700 dark:text-zinc-300">City</div>
        <Text className="block pl-1 text-sm">{city}</Text>
        <Text className="block grow content-end text-xs">
          Provided by{' '}
          <ExternalLink href="https://gis.utah.gov/products/sgid/boundaries/municipal/">
            municipal boundaries
          </ExternalLink>
        </Text>
      </div>
      <div
        className="flex flex-col gap-1 rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800"
        role="presentation"
      >
        <div className="w-fit cursor-default text-sm font-medium text-zinc-700 dark:text-zinc-300">Zip code</div>
        <Text className="block pl-1 text-sm">{zip}</Text>
        <Text className="block grow content-end text-xs">
          Provided by{' '}
          <ExternalLink href="https://gis.utah.gov/products/sgid/boundaries/zip-codes/">zip code areas</ExternalLink>
        </Text>
      </div>
      <div
        className="flex flex-col gap-1 rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800"
        role="presentation"
      >
        <div className="w-fit cursor-default text-sm font-medium text-zinc-700 dark:text-zinc-300">County</div>
        <Text className="block pl-1 text-sm">{startCase(county.toLowerCase())}</Text>
        <Text className="block grow content-end text-xs">
          Provided by{' '}
          <ExternalLink href="https://gis.utah.gov/products/sgid/boundaries/county/">county boundaries</ExternalLink>
        </Text>
      </div>
      <div
        className="flex flex-col gap-1 rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800"
        role="presentation"
      >
        <div className="w-fit cursor-default text-sm font-medium text-zinc-700 dark:text-zinc-300">
          UTM 12 NAD83 coordinates
        </div>
        <Text className="block pl-1 text-sm">
          {spatial.x}, {spatial.y} m
        </Text>
      </div>
      <div
        className="flex flex-col gap-1 rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800"
        role="presentation"
      >
        <div className="w-fit cursor-default text-sm font-medium text-zinc-700 dark:text-zinc-300">
          WGS84 coordinates
        </div>
        <Text className="block pl-1 text-sm">
          {spatial.lat}, {spatial.lon}
        </Text>
      </div>
      <div
        className="flex flex-col gap-1 rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800"
        role="presentation"
      >
        <div className="w-fit cursor-default text-sm font-medium text-zinc-700 dark:text-zinc-300">Elevation</div>
        <Text className="block pl-1 text-sm">{elevation.meters} m</Text>
        <Text className="block pl-1 text-sm">{elevation.feet} ft</Text>
        <Text className="block grow content-end text-xs">
          Provided by <ExternalLink href="https://elevation.nationalmap.gov/">The National Map</ExternalLink>
        </Text>
      </div>
      <div
        className="flex flex-col gap-1 rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800"
        role="presentation"
      >
        <div className="w-fit cursor-default text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Land administration category
        </div>
        <Text className="block pl-1 text-sm">{ownership}</Text>
        <Text className="block grow content-end text-xs">
          Provided by{' '}
          <ExternalLink href="https://gis.utah.gov/products/sgid/cadastre/land-ownership/">land ownership</ExternalLink>
        </Text>
      </div>
      <div
        className="flex flex-col gap-1 rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800"
        role="presentation"
      >
        <div className="w-fit cursor-default text-sm font-medium text-zinc-700 dark:text-zinc-300">
          US National Grid
        </div>
        <Text className="block pl-1 text-sm">{grid}</Text>
        <Text className="block grow content-end text-xs">
          Provided by the{' '}
          <ExternalLink href="https://gis.utah.gov/products/sgid/indices/national-grid-index/">
            national grid
          </ExternalLink>
        </Text>
      </div>
      <div
        className="flex flex-col gap-1 rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800"
        role="presentation"
      >
        <div className="w-fit cursor-default text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Imagery flight metadata
        </div>
        <Text className="block pl-1 text-sm">
          {flightDate.loading && 'Loading...'}
          {flightDate.date && `${flightDate.resolution} resolution flown on ${flightDate.date}`}
        </Text>
      </div>
    </div>
  );
};

IdentifyInformation.propTypes = {
  location: PropTypes.object,
  apiKey: PropTypes.string.isRequired,
  wkid: PropTypes.number,
};
