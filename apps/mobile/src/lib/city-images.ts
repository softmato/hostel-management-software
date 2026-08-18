/**
 * A photograph for a city card.
 *
 * ## Why these are hard-coded, and why they are Wikimedia
 *
 * There is no city entity on the server — `cityCounts` derives the list from
 * whatever `location.city` strings the listings happen to carry, so there is
 * nothing to hang an uploaded image on and no admin screen that could set one.
 * The alternative to a table was reusing a hostel's own cover photo as its
 * city's picture, which puts the same building on the card twice as soon as one
 * city has one listing.
 *
 * Every URL below was fetched and checked (HTTP 200, real bytes) before it was
 * written down — these are Wikimedia's own pre-rendered `500px-` thumbnails,
 * which is the width bucket that exists for all fourteen. **Do not edit the
 * width.** Wikimedia no longer renders thumbnails on demand for sizes outside
 * its buckets — `640px-` returns an HTML error page for most of these files, and
 * an error page decodes as a broken image, not as a missing one. Adding a city
 * means fetching its URL and checking the response, not copying a number.
 *
 * The files are Commons media, reused here under their CC licences with
 * attribution kept at the source page. Swap the whole table for our own
 * photography whenever there is any.
 *
 * ## The lookup is forgiving, because the input is a free-text address field
 *
 * `location.city` is typed by whoever registered the hostel. "kathmandu",
 * "Kathmandu Metropolitan City" and "KATHMANDU" are one city and have to hit one
 * row, so the key is normalised rather than matched exactly. A city with no
 * photograph returns `null` and the card draws a tinted block instead — every
 * city in the payload gets a card either way, because dropping the ones we have
 * no picture for would hide real listings.
 */

const COMMONS = "https://upload.wikimedia.org/wikipedia/commons/thumb";

/** Keyed by `normalizeCity` output, not by display name. */
const CITY_IMAGES: Record<string, string> = {
  bhaktapur: `${COMMONS}/d/d9/Nyatpola_%26_Bhairav_Temple.jpg/500px-Nyatpola_%26_Bhairav_Temple.jpg`,
  bharatpur: `${COMMONS}/8/8a/Gaindakot_and_Bharatpur_at_Narayani_River%2C_Nepal_2020_-1.jpg/500px-Gaindakot_and_Bharatpur_at_Narayani_River%2C_Nepal_2020_-1.jpg`,
  biratnagar: `${COMMONS}/8/82/Biratnagar_Bazar_Drone_view.png/500px-Biratnagar_Bazar_Drone_view.png`,
  birgunj: `${COMMONS}/e/e4/Ghadiarwa_mai_temple_3.jpg/500px-Ghadiarwa_mai_temple_3.jpg`,
  butwal: `${COMMONS}/c/c0/Butwal.jpg/500px-Butwal.jpg`,
  dhangadhi: `${COMMONS}/b/b8/Behdaba_Temple_Urmarampur_Dhangadi_Kailali_Nepal_Rajesh_Dhungana_%281%29.jpg/500px-Behdaba_Temple_Urmarampur_Dhangadi_Kailali_Nepal_Rajesh_Dhungana_%281%29.jpg`,
  dharan: `${COMMONS}/2/23/Dharan_Clock_tower.jpg/500px-Dharan_Clock_tower.jpg`,
  hetauda: `${COMMONS}/b/b2/Sahid_Smarak%2C_Hetauda.jpg/500px-Sahid_Smarak%2C_Hetauda.jpg`,
  itahari: `${COMMONS}/a/ad/Itahari..jpg/500px-Itahari..jpg`,
  janakpur: `${COMMONS}/a/a9/Janki_Mandir.JPG/500px-Janki_Mandir.JPG`,
  kathmandu: `${COMMONS}/3/35/Kathmandu-Durbar_Square-06-Mahavishnu-Kuh-Vishnu-Pratapamalla-Jagannath-2007-gje.jpg/500px-Kathmandu-Durbar_Square-06-Mahavishnu-Kuh-Vishnu-Pratapamalla-Jagannath-2007-gje.jpg`,
  lalitpur: `${COMMONS}/4/40/Nepal_Patan_Mangal.jpg/500px-Nepal_Patan_Mangal.jpg`,
  nepalgunj: `${COMMONS}/8/81/Bageshwori_Temple_Nepalgunj%2C_Banke.jpg/500px-Bageshwori_Temple_Nepalgunj%2C_Banke.jpg`,
  pokhara: `${COMMONS}/9/9a/Pokhara_Valley.jpg/500px-Pokhara_Valley.jpg`,
};

/**
 * Other names for a city that already has a row. Only genuine synonyms — Patan
 * *is* Lalitpur, and a hostel registered in "Chitwan" is in Bharatpur, the only
 * city in that district. A near-miss belongs in `CITY_IMAGES` with its own
 * photograph, not here.
 */
const ALIASES: Record<string, string> = {
  chitwan: "bharatpur",
  janakpurdham: "janakpur",
  ktm: "kathmandu",
  patan: "lalitpur",
};

/**
 * The suffixes Nepali municipalities carry in official addresses. Stripped so
 * "Pokhara Metropolitan City" and "Pokhara" are one key — people type both, and
 * the registration form has never normalised either.
 */
const SUFFIXES =
  /\s+(sub[-\s]?metropolitan|metropolitan|municipality|municipal|metro|city|nagarpalika)\b/g;

export function normalizeCity(city: string): string {
  const base = city
    .toLowerCase()
    .replace(/[^a-z\s-]/g, "")
    .replace(SUFFIXES, "")
    .replace(/[\s-]+/g, " ")
    .trim();

  return ALIASES[base] ?? base;
}

/** The photograph for a city, or `null` when we have none for it. */
export function cityImageUrl(city: string): string | null {
  if (!city.trim()) {
    return null;
  }

  return CITY_IMAGES[normalizeCity(city)] ?? null;
}
