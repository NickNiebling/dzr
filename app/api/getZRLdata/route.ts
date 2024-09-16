import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const maxDuration = 60;

// Define the type for divisionIdList
type DivisionIdList = { [key: string]: string };

export async function GET(request: Request) {
  // Parse the race query parameter from the request URL
  const { searchParams } = new URL(request.url);
  const race = searchParams.get('race') ? parseInt(searchParams.get('race')!) : 1; // Default to race 1 if not provided

  // Path to the division_ids.json file
  const divisionFilePath = path.join(process.cwd(), 'app/api/getZRLdata/division_ids.json');

  // Path to the output directory and file
  const outputDirPath = path.join(process.cwd(), 'public/ZRLresults');
  const outputFilePath = path.join(outputDirPath, `race_${race}.json`);

  let divisionIdList: DivisionIdList;
  try {
    // Read and parse the JSON file
    const fileContent = fs.readFileSync(divisionFilePath, 'utf-8');
    divisionIdList = JSON.parse(fileContent);
  } catch (error) {
    console.error('Error reading or parsing division_ids.json:', error);
    return NextResponse.json({ error: 'Error reading or parsing division_ids.json' }, { status: 500 });
  }

  const fetchData = async (season: number, race: number, division: string) => {
    const url = `https://www.wtrl.racing/wtrl_api/json/cache.php?competition=zrl&type=results&season=${season}&race=${race}&division=${division}`;
    
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
      "Authorization": `Bearer ${process.env.WTRL_AUTH_TOKEN}`,
      "Cookie": `wtrl_sid=${process.env.WTRL_SID}; wtrl_ouid=${process.env.WTRL_OUID}`,
    };

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`Error fetching data: ${response.statusText}`);
    }
    return response.json();
  };

  try {
    const data: any[] = [];

    for (const [key, division] of Object.entries(divisionIdList)) {
      try {
        console.log(`Fetching data for division: ${division}`);
        const result = await fetchData(14, race, division as string); // Use the race variable
        if (Array.isArray(result.data)) {
          data.push(...result.data);
        } else {
          console.warn(`Unexpected data format for division ${division}:`, result);
        }
      } catch (error) {
        console.error(`Error fetching data for division ${division}:`, error);
      }
    }

    // Ensure the directory exists
    if (!fs.existsSync(outputDirPath)) {
      fs.mkdirSync(outputDirPath, { recursive: true });
    }

    // Save the data to a JSON file
    fs.writeFileSync(outputFilePath, JSON.stringify(data, null, 2));
    console.log('Data saved to:', outputFilePath);

    // Return a simple success message
    return NextResponse.json({ message: 'Data saved' });

  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: `Something went wrong: ${error.message}` }, { status: 500 });
    } else {
      return NextResponse.json({ error: 'An unknown error occurred' }, { status: 500 });
    }
  }
}
