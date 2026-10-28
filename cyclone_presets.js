/**
 * cyclone_presets.js - Official IMD North Indian Ocean Cyclone Tracks & Bulletins
 * Includes:
 * - Cyclone Arnab (Latest 28 Oct 2026 Bulletin #16: 16.4°N, 82.0°E near Narsapur)
 * - Cyclone Arnab (Earlier 27 Oct 2026 Bulletin #12: 16.2°N, 83.7°E)
 * - Cyclone Dana (Oct 2024: 19.3°N, 88.2°E landfall near Dhamra)
 * - Cyclone Remal (May 2024: 20.7°N, 89.2°E Sundarbans)
 * - Cyclone Michaung (Dec 2023: 13.5°N, 81.0°E South Andhra)
 * - Cyclone Biparjoy (June 2023: 21.9°N, 66.7°E Gujarat / Jakhau)
 */

const CYCLONE_PRESETS = {
  arnab_2026: {
    id: "arnab_2026",
    name: "Arnab",
    year: 2026,
    basin: "North Indian Ocean (Bay of Bengal)",
    category: "VSCS",
    categoryFull: "Very Severe Cyclonic Storm",
    statusBadge: "IMD LATEST BULLETIN (28 OCT)",
    issueTime: "28 Oct 2026, 0530 IST (0000 UTC)",
    bulletinNo: "Bulletin No. 16 (BOB/06/2026)",
    advisoryType: "National Cyclone Warning for Andhra Pradesh Coast (Red Message)",
    agency: "India Meteorological Department (IMD) / RSMC New Delhi",
    sourceName: "IMD RSMC New Delhi (Bulletin No. 16)",
    sourceUrl: "https://rsmcnewdelhi.imd.gov.in",
    currentCenter: { lat: 16.40, lon: 82.00, kt: 75, kmph: 140, cat: "VSCS", pressure: 978 },
    landfallEstimate: "Very close to Andhra Pradesh coast near Narsapur / Machilipatnam",
    rawBulletin: `INDIA METEOROLOGICAL DEPARTMENT
BULLETIN NO. 16 (BOB/06/2026)
TIME OF ISSUE: 0830 HOURS IST DATED 28.10.2026
FROM: INDIA METEOROLOGICAL DEPARTMENT (FAX NO. 24643965/24699216/24623220)
TO: CONTROL ROOM, NDM, MINISTRY OF HOME AFFAIRS

SUB: VERY SEVERE CYCLONIC STORM “ARNAB” OVER WESTCENTRAL BAY OF BENGAL CLOSE TO ANDHRA PRADESH COAST (CYCLONE WARNING FOR ANDHRA PRADESH AND ADJOINING SOUTH ODISHA COASTS: RED MESSAGE)

THE VERY SEVERE CYCLONIC STORM “ARNAB” [PRONUNCIATION: ORNAB] OVER WESTCENTRAL BAY OF BENGAL MOVED WEST-NORTHWESTWARDS AND LAY CENTRED AT 0530 HOURS IST OF TODAY, THE 28TH OCTOBER, 2026 OVER WESTCENTRAL BAY OF BENGAL CLOSE TO ANDHRA PRADESH COAST, NEAR LATITUDE 16.4°N AND LONGITUDE 82.0°E, ABOUT 30 KM EAST OF NARSAPUR, 45 KM SOUTH-SOUTHWEST OF YANAM, 70 KM SOUTH-SOUTHWEST OF KAKINADA AND 220 KM SOUTH-SOUTHWEST OF VISAKHAPATNAM.

IT IS VERY LIKELY TO MOVE NORTH-NORTHWESTWARDS AND CROSS ANDHRA PRADESH COAST CLOSE TO NARSAPUR/MACHILIPATNAM DURING NEXT 6 TO 12 HOURS AS A VERY SEVERE CYCLONIC STORM WITH MAXIMUM SUSTAINED WIND SPEED OF 120-130 KMPH GUSTING TO 145 KMPH.

FORECAST TRACK AND INTENSITY ARE GIVEN IN THE FOLLOWING TABLE:
Date/Time (IST) | Position (Lat. °N/ Long. °E) | Maximum sustained surface wind speed (kmph) | Category of cyclonic disturbance
28.10.26/0530 | 16.4 / 82.0 | 130-140 GUSTING TO 155 | VERY SEVERE CYCLONIC STORM
28.10.26/1130 | 16.6 / 81.8 | 120-130 GUSTING TO 145 | VERY SEVERE CYCLONIC STORM
28.10.26/1730 | 17.1 / 81.6 | 90-100 GUSTING TO 115 | SEVERE CYCLONIC STORM
28.10.26/2330 | 17.8 / 81.6 | 60-70 GUSTING TO 80 | CYCLONIC STORM
29.10.26/0530 | 18.6 / 81.6 | 40-50 GUSTING TO 60 | DEPRESSION
29.10.26/1730 | 20.2 / 81.7 | 25-35 GUSTING TO 45 | WELL MARKED LOW PRESSURE AREA`,
    points: [
      { t: "25/12", lat: 15.08, lon: 90.44, kt: 30, kmph: 55, cat: "DD", kind: "obs" },
      { t: "26/00", lat: 15.38, lon: 88.96, kt: 35, kmph: 65, cat: "CS", kind: "obs" },
      { t: "26/12", lat: 15.71, lon: 87.26, kt: 55, kmph: 100, cat: "SCS", kind: "obs" },
      { t: "27/00", lat: 15.89, lon: 84.94, kt: 75, kmph: 140, cat: "VSCS", kind: "obs" },
      { t: "27/06", lat: 16.20, lon: 83.70, kt: 85, kmph: 155, cat: "VSCS", kind: "obs" },
      { t: "27/12", lat: 16.27, lon: 83.12, kt: 85, kmph: 155, cat: "VSCS", kind: "obs" },
      { t: "27/18", lat: 16.32, lon: 82.50, kt: 80, kmph: 150, cat: "VSCS", kind: "obs" },
      { t: "28/00", lat: 16.40, lon: 82.00, kt: 75, kmph: 140, cat: "VSCS", kind: "now", lead_hours: 0 },
      { t: "28/06", lat: 16.60, lon: 81.80, kt: 70, kmph: 130, cat: "VSCS", kind: "fc", lead_hours: 6 },
      { t: "28/12", lat: 17.10, lon: 81.60, kt: 55, kmph: 100, cat: "SCS", kind: "fc", lead_hours: 12 },
      { t: "28/18", lat: 17.80, lon: 81.60, kt: 40, kmph: 75, cat: "CS", kind: "fc", lead_hours: 18 },
      { t: "29/06", lat: 18.60, lon: 81.60, kt: 25, kmph: 45, cat: "D", kind: "fc", lead_hours: 30 },
      { t: "29/18", lat: 20.20, lon: 81.70, kt: 20, kmph: 35, cat: "WML", kind: "fc", lead_hours: 42 }
    ]
  },

  arnab_2026_oct27: {
    id: "arnab_2026_oct27",
    name: "Arnab (Oct 27 Advisory)",
    year: 2026,
    basin: "North Indian Ocean (Bay of Bengal)",
    category: "VSCS",
    categoryFull: "Very Severe Cyclonic Storm",
    statusBadge: "IMD BULLETIN #12 (27 OCT)",
    issueTime: "27 Oct 2026, 0600 UTC (11:30 IST)",
    bulletinNo: "Bulletin No. 12 (BOB/06/2026)",
    advisoryType: "Tropical Cyclone Advisory",
    agency: "India Meteorological Department (IMD) / RSMC New Delhi",
    sourceName: "IMD RSMC New Delhi (Bulletin No. 12)",
    sourceUrl: "https://rsmcnewdelhi.imd.gov.in",
    currentCenter: { lat: 16.20, lon: 83.70, kt: 85, kmph: 155, cat: "VSCS", pressure: 970 },
    landfallEstimate: "Projected toward Andhra Pradesh / South Odisha",
    rawBulletin: `INDIA METEOROLOGICAL DEPARTMENT
BULLETIN NO. 12 (BOB/06/2026)
TIME OF ISSUE: 1430 HOURS IST DATED 27.10.2026
FROM: INDIA METEOROLOGICAL DEPARTMENT, NEW DELHI
SUB: VERY SEVERE CYCLONIC STORM “ARNAB” OVER WESTCENTRAL BAY OF BENGAL

THE VERY SEVERE CYCLONIC STORM “ARNAB” LAY CENTRED AT 0600 UTC OF 27TH OCTOBER 2026 NEAR LATITUDE 16.2°N AND LONGITUDE 83.7°E, ABOUT 170 KM SSE OF VISAKHAPATNAM AND 180 KM ESE OF KAKINADA.`,
    points: [
      { t: "24/12", lat: 15.81, lon: 90.67, kt: 25, kmph: 45, cat: "D", kind: "obs" },
      { t: "24/18", lat: 15.63, lon: 90.94, kt: 25, kmph: 45, cat: "D", kind: "obs" },
      { t: "25/00", lat: 15.29, lon: 91.15, kt: 25, kmph: 45, cat: "D", kind: "obs" },
      { t: "25/06", lat: 15.08, lon: 90.94, kt: 30, kmph: 55, cat: "DD", kind: "obs" },
      { t: "25/12", lat: 15.08, lon: 90.44, kt: 30, kmph: 55, cat: "DD", kind: "obs" },
      { t: "25/18", lat: 15.30, lon: 89.64, kt: 30, kmph: 55, cat: "DD", kind: "obs" },
      { t: "26/00", lat: 15.38, lon: 88.96, kt: 35, kmph: 65, cat: "CS", kind: "obs" },
      { t: "26/06", lat: 15.51, lon: 88.17, kt: 45, kmph: 85, cat: "CS", kind: "obs" },
      { t: "26/12", lat: 15.71, lon: 87.26, kt: 55, kmph: 100, cat: "SCS", kind: "obs" },
      { t: "26/18", lat: 15.89, lon: 86.00, kt: 65, kmph: 120, cat: "VSCS", kind: "obs" },
      { t: "27/00", lat: 15.89, lon: 84.94, kt: 75, kmph: 140, cat: "VSCS", kind: "obs" },
      { t: "27/03", lat: 15.98, lon: 84.32, kt: 80, kmph: 150, cat: "VSCS", kind: "obs" },
      { t: "27/06", lat: 16.20, lon: 83.70, kt: 85, kmph: 155, cat: "VSCS", kind: "now", lead_hours: 0 },
      { t: "27/12", lat: 16.27, lon: 83.12, kt: 85, kmph: 155, cat: "VSCS", kind: "fc", lead_hours: 6 },
      { t: "27/18", lat: 16.27, lon: 82.62, kt: 75, kmph: 140, cat: "VSCS", kind: "fc", lead_hours: 12 },
      { t: "28/00", lat: 16.39, lon: 82.14, kt: 70, kmph: 130, cat: "VSCS", kind: "fc", lead_hours: 18 },
      { t: "28/06", lat: 16.99, lon: 81.84, kt: 55, kmph: 100, cat: "SCS", kind: "fc", lead_hours: 24 },
      { t: "28/18", lat: 18.30, lon: 81.72, kt: 45, kmph: 85, cat: "CS", kind: "fc", lead_hours: 36 },
      { t: "29/06", lat: 20.11, lon: 81.62, kt: 30, kmph: 55, cat: "DD", kind: "fc", lead_hours: 48 },
      { t: "29/18", lat: 22.02, lon: 81.73, kt: 25, kmph: 45, cat: "D", kind: "fc", lead_hours: 60 }
    ]
  },

  dana_2024: {
    id: "dana_2024",
    name: "Dana",
    year: 2024,
    basin: "North Indian Ocean (Bay of Bengal)",
    category: "SCS",
    categoryFull: "Severe Cyclonic Storm",
    statusBadge: "IMD BEST TRACK ARCHIVE",
    issueTime: "24 Oct 2024, 1130 UTC (17:00 IST)",
    bulletinNo: "Bulletin No. 16 (BOB/06/2024)",
    advisoryType: "National Cyclone Warning for Odisha and West Bengal",
    agency: "India Meteorological Department (IMD) / RSMC New Delhi",
    sourceName: "IMD RSMC New Delhi (BOB/06/2024)",
    sourceUrl: "https://rsmcnewdelhi.imd.gov.in",
    currentCenter: { lat: 19.30, lon: 88.20, kt: 60, kmph: 110, cat: "SCS", pressure: 984 },
    landfallEstimate: "North Odisha coast near Dhamra Port / Bhitarkanika",
    rawBulletin: `INDIA METEOROLOGICAL DEPARTMENT
BULLETIN NO. 16 (BOB/06/2024)
TIME OF ISSUE: 1730 HOURS IST DATED 24.10.2024
FROM: INDIA METEOROLOGICAL DEPARTMENT, NEW DELHI
SUB: SEVERE CYCLONIC STORM “DANA” OVER NORTHWEST BAY OF BENGAL (CYCLONE WARNING FOR ODISHA AND WEST BENGAL COASTS: RED MESSAGE)

THE SEVERE CYCLONIC STORM “DANA” OVER NORTHWEST BAY OF BENGAL LAY CENTRED AT 1130 HOURS UTC OF 24TH OCTOBER 2024 OVER NORTHWEST BAY OF BENGAL, NEAR LATITUDE 19.3°N AND LONGITUDE 88.2°E, ABOUT 210 KM SE OF PARADIP AND 240 KM SSE OF DHAMRA.`,
    points: [
      { t: "22/12", lat: 14.50, lon: 91.20, kt: 25, kmph: 45, cat: "D", kind: "obs" },
      { t: "23/00", lat: 15.60, lon: 90.50, kt: 30, kmph: 55, cat: "DD", kind: "obs" },
      { t: "23/12", lat: 16.50, lon: 89.60, kt: 40, kmph: 75, cat: "CS", kind: "obs" },
      { t: "24/00", lat: 17.80, lon: 88.90, kt: 50, kmph: 90, cat: "CS", kind: "obs" },
      { t: "24/06", lat: 18.50, lon: 88.50, kt: 55, kmph: 100, cat: "SCS", kind: "obs" },
      { t: "24/11", lat: 19.30, lon: 88.20, kt: 60, kmph: 110, cat: "SCS", kind: "now", lead_hours: 0 },
      { t: "24/17", lat: 19.90, lon: 87.60, kt: 65, kmph: 120, cat: "SCS", kind: "fc", lead_hours: 6 },
      { t: "24/23", lat: 20.50, lon: 87.10, kt: 65, kmph: 120, cat: "SCS", kind: "fc", lead_hours: 12 },
      { t: "25/05", lat: 21.00, lon: 86.80, kt: 60, kmph: 110, cat: "SCS", kind: "fc", lead_hours: 18 },
      { t: "25/11", lat: 21.40, lon: 86.40, kt: 45, kmph: 80, cat: "CS", kind: "fc", lead_hours: 24 },
      { t: "25/17", lat: 21.70, lon: 85.80, kt: 30, kmph: 50, cat: "D", kind: "fc", lead_hours: 30 },
      { t: "26/05", lat: 21.90, lon: 85.00, kt: 20, kmph: 35, cat: "WML", kind: "fc", lead_hours: 42 }
    ]
  },

  remal_2024: {
    id: "remal_2024",
    name: "Remal",
    year: 2024,
    basin: "North Indian Ocean (Bay of Bengal)",
    category: "SCS",
    categoryFull: "Severe Cyclonic Storm",
    statusBadge: "IMD BEST TRACK ARCHIVE",
    issueTime: "26 May 2024, 0600 UTC (11:30 IST)",
    bulletinNo: "Bulletin No. 11 (BOB/01/2024)",
    advisoryType: "National Cyclone Warning for West Bengal & Bangladesh",
    agency: "India Meteorological Department (IMD) / RSMC New Delhi",
    sourceName: "IMD RSMC New Delhi (BOB/01/2024)",
    sourceUrl: "https://rsmcnewdelhi.imd.gov.in",
    currentCenter: { lat: 20.70, lon: 89.20, kt: 60, kmph: 110, cat: "SCS", pressure: 978 },
    landfallEstimate: "Adjacent Sagar Island & Khepupara (Sundarbans)",
    rawBulletin: `INDIA METEOROLOGICAL DEPARTMENT
BULLETIN NO. 11 (BOB/01/2024)
TIME OF ISSUE: 1430 HOURS IST DATED 26.05.2024
SUB: SEVERE CYCLONIC STORM “REMAL” OVER NORTH BAY OF BENGAL
THE SEVERE CYCLONIC STORM “REMAL” LAY CENTRED AT 0600 UTC OF 26TH MAY 2024 OVER NORTH BAY OF BENGAL NEAR LATITUDE 20.7°N AND LONGITUDE 89.2°E.`,
    points: [
      { t: "24/18", lat: 16.50, lon: 89.50, kt: 25, kmph: 45, cat: "D", kind: "obs" },
      { t: "25/06", lat: 17.80, lon: 89.60, kt: 35, kmph: 65, cat: "CS", kind: "obs" },
      { t: "25/18", lat: 19.50, lon: 89.40, kt: 50, kmph: 90, cat: "CS", kind: "obs" },
      { t: "26/06", lat: 20.70, lon: 89.20, kt: 60, kmph: 110, cat: "SCS", kind: "now", lead_hours: 0 },
      { t: "26/12", lat: 21.60, lon: 89.20, kt: 65, kmph: 120, cat: "SCS", kind: "fc", lead_hours: 6 },
      { t: "26/18", lat: 22.40, lon: 89.30, kt: 60, kmph: 110, cat: "SCS", kind: "fc", lead_hours: 12 },
      { t: "27/00", lat: 23.10, lon: 89.50, kt: 45, kmph: 80, cat: "CS", kind: "fc", lead_hours: 18 },
      { t: "27/06", lat: 23.80, lon: 89.90, kt: 35, kmph: 65, cat: "CS", kind: "fc", lead_hours: 24 },
      { t: "27/18", lat: 24.80, lon: 91.20, kt: 25, kmph: 45, cat: "D", kind: "fc", lead_hours: 36 }
    ]
  },

  michaung_2023: {
    id: "michaung_2023",
    name: "Michaung",
    year: 2023,
    basin: "North Indian Ocean (Bay of Bengal)",
    category: "SCS",
    categoryFull: "Severe Cyclonic Storm",
    statusBadge: "IMD BEST TRACK ARCHIVE",
    issueTime: "04 Dec 2023, 0600 UTC (11:30 IST)",
    bulletinNo: "Bulletin No. 14 (BOB/05/2023)",
    advisoryType: "National Cyclone Warning for Andhra Pradesh Coast",
    agency: "India Meteorological Department (IMD) / RSMC New Delhi",
    sourceName: "IMD RSMC New Delhi (BOB/05/2023)",
    sourceUrl: "https://rsmcnewdelhi.imd.gov.in",
    currentCenter: { lat: 13.50, lon: 81.00, kt: 55, kmph: 100, cat: "SCS", pressure: 988 },
    landfallEstimate: "South Andhra Pradesh coast close to Bapatla",
    rawBulletin: `INDIA METEOROLOGICAL DEPARTMENT
BULLETIN NO. 14 (BOB/05/2023)
TIME OF ISSUE: 1430 HOURS IST DATED 04.12.2023
SUB: SEVERE CYCLONIC STORM “MICHAUNG” OVER SOUTHWEST BAY OF BENGAL ALONG NORTH TAMILNADU AND SOUTH ANDHRA PRADESH COASTS.`,
    points: [
      { t: "02/00", lat: 10.20, lon: 84.80, kt: 25, kmph: 45, cat: "D", kind: "obs" },
      { t: "02/12", lat: 10.80, lon: 83.90, kt: 30, kmph: 55, cat: "DD", kind: "obs" },
      { t: "03/00", lat: 11.50, lon: 83.00, kt: 40, kmph: 75, cat: "CS", kind: "obs" },
      { t: "03/12", lat: 12.40, lon: 82.00, kt: 50, kmph: 90, cat: "CS", kind: "obs" },
      { t: "04/00", lat: 13.10, lon: 81.30, kt: 55, kmph: 100, cat: "SCS", kind: "obs" },
      { t: "04/06", lat: 13.50, lon: 81.00, kt: 55, kmph: 100, cat: "SCS", kind: "now", lead_hours: 0 },
      { t: "04/12", lat: 14.20, lon: 80.60, kt: 55, kmph: 100, cat: "SCS", kind: "fc", lead_hours: 6 },
      { t: "04/18", lat: 14.80, lon: 80.30, kt: 55, kmph: 100, cat: "SCS", kind: "fc", lead_hours: 12 },
      { t: "05/00", lat: 15.30, lon: 80.20, kt: 50, kmph: 95, cat: "SCS", kind: "fc", lead_hours: 18 },
      { t: "05/06", lat: 15.80, lon: 80.30, kt: 45, kmph: 85, cat: "CS", kind: "fc", lead_hours: 24 },
      { t: "05/18", lat: 16.90, lon: 81.20, kt: 30, kmph: 55, cat: "DD", kind: "fc", lead_hours: 36 }
    ]
  },

  biparjoy_2023: {
    id: "biparjoy_2023",
    name: "Biparjoy",
    year: 2023,
    basin: "North Indian Ocean (Arabian Sea)",
    category: "VSCS",
    categoryFull: "Very Severe Cyclonic Storm",
    statusBadge: "IMD BEST TRACK ARCHIVE",
    issueTime: "14 June 2023, 0600 UTC (11:30 IST)",
    bulletinNo: "Bulletin No. 52 (ARB/01/2023)",
    advisoryType: "National Cyclone Warning for Gujarat Coast (Red Message)",
    agency: "India Meteorological Department (IMD) / RSMC New Delhi",
    sourceName: "IMD RSMC New Delhi (ARB/01/2023)",
    sourceUrl: "https://rsmcnewdelhi.imd.gov.in",
    currentCenter: { lat: 21.90, lon: 66.70, kt: 75, kmph: 140, cat: "VSCS", pressure: 968 },
    landfallEstimate: "Near Jakhau Port (Kutch, Gujarat)",
    rawBulletin: `INDIA METEOROLOGICAL DEPARTMENT
BULLETIN NO. 52 (ARB/01/2023)
TIME OF ISSUE: 1430 HOURS IST DATED 14.06.2023
SUB: VERY SEVERE CYCLONIC STORM “BIPARJOY” OVER NORTHEAST ARABIAN SEA (CYCLONE WARNING FOR SAURASHTRA & KUTCH COASTS: RED MESSAGE).`,
    points: [
      { t: "12/06", lat: 19.60, lon: 67.60, kt: 85, kmph: 155, cat: "VSCS", kind: "obs" },
      { t: "13/06", lat: 20.70, lon: 67.10, kt: 80, kmph: 150, cat: "VSCS", kind: "obs" },
      { t: "14/06", lat: 21.90, lon: 66.70, kt: 75, kmph: 140, cat: "VSCS", kind: "now", lead_hours: 0 },
      { t: "14/18", lat: 22.40, lon: 67.00, kt: 70, kmph: 130, cat: "VSCS", kind: "fc", lead_hours: 12 },
      { t: "15/06", lat: 22.90, lon: 67.80, kt: 65, kmph: 120, cat: "VSCS", kind: "fc", lead_hours: 24 },
      { t: "15/18", lat: 23.40, lon: 68.60, kt: 55, kmph: 100, cat: "SCS", kind: "fc", lead_hours: 36 },
      { t: "16/06", lat: 24.10, lon: 70.00, kt: 40, kmph: 75, cat: "CS", kind: "fc", lead_hours: 48 },
      { t: "16/18", lat: 24.80, lon: 71.80, kt: 25, kmph: 45, cat: "D", kind: "fc", lead_hours: 60 }
    ]
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CYCLONE_PRESETS;
}
if (typeof window !== 'undefined') {
  window.CYCLONE_PRESETS = CYCLONE_PRESETS;
}
