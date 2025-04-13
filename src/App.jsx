// src/App.jsx
import { Analytics } from "@vercel/analytics/react";
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, useMapEvents, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { motion, AnimatePresence } from "framer-motion";

function MapClickHandler({ onClick }) {
  useMapEvents({ click: (e) => onClick(e.latlng) });
  return null;
}

function ZoomToBounds({ from, to }) {
  const map = useMap();
  useEffect(() => {
    if (from && to) {
      const bounds = L.latLngBounds([from, to]);
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [from, to, map]);
  return null;
}

const guessIcon = new L.Icon({
  iconUrl: "https://i.imgur.com/Vroh692.png",
  iconSize: [70, 70],
  iconAnchor: [35, 70],
  popupAnchor: [0, -70],
});

const actualIcon = new L.Icon({
  iconUrl: "https://i.imgur.com/RoUzCoN.png",
  iconSize: [70, 70],
  iconAnchor: [35, 70],
  popupAnchor: [0, -70],
});

function App() {
  function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
  const [artifacts, setArtifacts] = useState([]);
  const [current, setCurrent] = useState(0);
  const [guess, setGuess] = useState(null);
  const [lockedIn, setLockedIn] = useState(false);
  const [summary, setSummary] = useState('');
  const [score, setScore] = useState(0);
  const [rounds, setRounds] = useState([]);
  const [roundPoints, setRoundPoints] = useState(0);

  useEffect(() => {
    fetch("/artifacts.json")
      .then((res) => res.json())
      .then((data) => {
        const parsed = data.map((a) => {
          const match = a.coordinates.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
          const coords = match ? [parseFloat(match[2]), parseFloat(match[1])] : [0, 0];
          return {
            label: a.artifactLabel,
            image: a.image,
            year: (() => {
              const match = a.inception.match(/(-?\d{1,6})/);
              if (!match) return 'Unknown';
              const raw = match[1];
              const absolute = raw.replace('-', '').replace(/^0+/, '') || '0';
              return raw.startsWith('-') ? `${absolute} BCE` : `${absolute} CE`;
            })(),
            coords: coords,
            wikipedia: a.article,
            discoverySiteLabel: a.discoverySiteLabel
          };
        });
        setArtifacts(shuffleArray(parsed));
      });
  }, []);

  const artifact = artifacts[current];

  useEffect(() => {
    if (artifact?.wikipedia) {
      const title = decodeURIComponent(artifact.wikipedia.split('/').pop());
      fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`)
        .then((res) => res.json())
        .then((data) => setSummary(data.extract || ''))
        .catch(() => setSummary(''));
    }
  }, [artifact]);

  const handleGuess = (latlng) => {
    if (!lockedIn) setGuess(latlng);
  };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const toRad = (v) => (v * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const getPoints = (distance) => {
    if (distance <= 200) return 1500;
    if (distance <= 400) return 1000;
    if (distance <= 600) return 700;
    if (distance <= 1200) return 400;
    return 0;
  };

  const lockInGuess = () => {
    if (guess && artifact) {
      setLockedIn(true);
      const dist = calculateDistance(
        guess.lat,
        guess.lng,
        artifact.coords[0],
        artifact.coords[1]
      );
      const pts = getPoints(dist);
      setRoundPoints(pts);
      setScore((prev) => prev + pts);
      setRounds((prev) => [
        ...prev,
        {
          label: artifact.label,
          discovered: artifact.discoverySiteLabel,
          distance: dist.toFixed(2),
          points: pts,
          wikipedia: artifact.wikipedia
        }
      ]);
    }
  };

  const nextArtifact = () => {
    setGuess(null);
    setLockedIn(false);
    setCurrent((prev) => (prev + 1) % artifacts.length);
    setRoundPoints(0);
  };

  const restartGame = () => {
    setGuess(null);
    setLockedIn(false);
    setCurrent(0);
    setRounds([]);
    setScore(0);
    setRoundPoints(0);
    setArtifacts(shuffleArray(artifacts));
  };

  const distance =
    guess && artifact
      ? calculateDistance(
          guess.lat,
          guess.lng,
          artifact.coords[0],
          artifact.coords[1]
        ).toFixed(2)
      : null;

  if (!artifact) return <div className="p-4">Loading...</div>;

  return (
    <div className="min-h-screen w-full">
      <div className="relative z-0">
        <MapContainer center={[20, 0]} zoom={2} style={{ height: "60vh", width: "100vw" }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />
          <MapClickHandler onClick={handleGuess} />
          {guess && <Marker position={guess} icon={guessIcon}><Popup>Your Guess</Popup></Marker>}
          {lockedIn && (
            <>
              <Marker position={artifact.coords} icon={actualIcon}><Popup>Actual Location</Popup></Marker>
              {generateGreatCircle(guess, artifact.coords).map((segment, idx) => (
                <Polyline
                  key={idx}
                  positions={segment}
                  pathOptions={{
                    color: 'green',
                    dashArray: '10',
                    dashOffset: '10',
                    className: 'animated-polyline'
                  }}
                />
              ))}
              <ZoomToBounds from={guess} to={artifact.coords} />
            </>
          )}
        </MapContainer>
      </div>

      <div className="font-semibold relative z-10 flex flex-row flex-wrap justify-center items-start gap-10 px-10 py-16 w-full bg-gray-100">

      <Card className="w-[520px] font-semibold">
          <CardHeader className="text-3xl text-center">
            <CardTitle>Artifact Info:</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-between space-y-3">
            {lockedIn ? (
              <>
                <p className="text-gray-700 text-2xl">{artifact.label}</p>
                <p className="text-sm mt-2">{summary}</p>
                <p className="text-sm">Discovered in: {artifact.discoverySiteLabel}</p>
                <a
                  href={artifact.wikipedia}
                  className="text-blue-500 underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Wikipedia Article
                </a>
              </>
            ) : <p className="text-gray-400">Make a guess to reveal info</p>}
          </CardContent>
        </Card>

        <Card className="w-[520px]">
          <CardHeader className="text-center">
            {!lockedIn && guess && (
              <button
                className="mb-4 px-6 py-2 bg-green-600 text-white rounded-lg shadow hover:bg-green-700"
                onClick={lockInGuess}
              >
                Lock In Guess
              </button>
            )}
            <CardTitle className="text-3xl tracking-tight">Estimated Year: {artifact.year}</CardTitle>
          </CardHeader>
          <CardContent className="text-center flex-1 flex flex-col justify-between">
            <div className="w-full flex justify-center">
              <div className="max-w-[500px] w-full">
                <img
                  src={artifact.image}
                  alt={artifact.label}
                  style={{ maxWidth: "500px", width: "100%", height: "auto" }}
                  className="object-contain rounded-xl shadow"
                />
              </div>
            </div>
            {!lockedIn && guess && (
              <button
                className="mt-4 px-6 py-2 bg-green-600 text-white rounded-lg shadow hover:bg-green-700"
                onClick={lockInGuess}
              >
                Lock In Guess
              </button>
            )}
          </CardContent>
        </Card>

        <Card className="w-[520px] font-semibold">
          <CardHeader className="text-3xl text-center">
            <CardTitle>Results</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            {lockedIn ? (
              <>
                <p className="text-xl font-semibold">You were {distance} km away.</p>
                <motion.p
                  key={roundPoints}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.4 }}
                  className="text-lg text-green-700 !important"
                >
                  Points this round: {roundPoints}
                </motion.p>
                <p className="text-blue-600 text-lg font-bold">Total Score: {score}</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Artifact</TableHead>
                      <TableHead>Discovered In</TableHead>
                      <TableHead>Distance (km)</TableHead>
                      <TableHead>Points</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rounds.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <a
                            href={r.wikipedia}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 underline"
                          >
                            {r.label.length > 20 ? `${r.label.slice(0, 20)}...` : r.label}
                          </a>
                        </TableCell>
                        <TableCell>
                          {r.discovered.length > 18 ? `${r.discovered.slice(0, 18)}...` : r.discovered}
                        </TableCell>
                        <TableCell>{r.distance}</TableCell>
                        <TableCell>{r.points}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {rounds.length < 10 ? (
                  <button
                    className="mt-2 px-6 py-2 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700"
                    onClick={nextArtifact}
                  >
                    Next Artifact
                  </button>
                ) : (
                  <>
                    <p className="text-green-700 font-bold">Game Over! Final Score: {score}</p>
                    <button
                      className="mt-2 px-6 py-2 bg-red-600 text-white rounded-lg shadow hover:bg-red-700"
                      onClick={restartGame}
                    >
                      Restart Game
                    </button>
                  </>
                )}
              </>
            ) : <p className="text-gray-400">Make a guess to see your score</p>}
          </CardContent>
        </Card>
      </div>
      <Analytics />
    </div>
  );
}

function generateGreatCircle(start, end, numPoints = 100) {
  if (!start || !end) return [];

  const lat1 = (start.lat * Math.PI) / 180;
  const lon1 = (start.lng * Math.PI) / 180;
  const lat2 = (end[0] * Math.PI) / 180;
  const lon2 = (end[1] * Math.PI) / 180;

  const d = 2 * Math.asin(
    Math.sqrt(
      Math.sin((lat2 - lat1) / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
    )
  );

  if (d === 0) return [[[start.lat, start.lng], [end[0], end[1]]]];

  const points = [];
  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);

    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);

    const lat = (Math.atan2(z, Math.sqrt(x ** 2 + y ** 2)) * 180) / Math.PI;
    const lon = (Math.atan2(y, x) * 180) / Math.PI;

    points.push([lat, lon]);
  }

  return [points];
}

export default App;
