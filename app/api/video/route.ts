import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    // Try to read real backend data first
    const realDataPath = path.join(process.cwd(), 'pipeline_out', 'cctv_video', 'api_response.json');
    
    if (fs.existsSync(realDataPath)) {
      const data = JSON.parse(fs.readFileSync(realDataPath, 'utf-8'));
      return NextResponse.json(data);
    }
    
    // Fallback to mock data
    const mockDataPath = path.join(process.cwd(), 'public', 'api', 'events.json');
    if (fs.existsSync(mockDataPath)) {
      const data = JSON.parse(fs.readFileSync(mockDataPath, 'utf-8'));
      return NextResponse.json(data);
    }
    
    return NextResponse.json({ error: 'No data available' }, { status: 404 });
  } catch (error) {
    console.error('Error reading video data:', error);
    return NextResponse.json({ error: 'Failed to load data' }, { status: 500 });
  }
}
