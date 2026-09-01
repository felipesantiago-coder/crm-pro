import * as fs from 'fs';
import * as path from 'path';
import { extractPropertiesFromPdf } from '../src/lib/parse-resale-pdf';

async function main() {
  const pdfPath = path.resolve(__dirname, '../reference-repo/public/Imóveis Revenda qb_26.08.2026.pdf');
  const seedPath = path.resolve(__dirname, '../reference-repo/app/data/properties.json');

  if (!fs.existsSync(pdfPath)) {
    console.error('PDF not found:', pdfPath);
    process.exit(1);
  }
  if (!fs.existsSync(seedPath)) {
    console.error('Seed data not found:', seedPath);
    process.exit(1);
  }

  const pdfBuffer = fs.readFileSync(pdfPath);
  const seed: any[] = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));

  // Build seed lookup by code (last occurrence wins for dedup)
  const seedByCode = new Map<string, any>();
  for (const s of seed) {
    seedByCode.set(s.code, s);
  }

  console.log('Parsing PDF...');
  const result = await extractPropertiesFromPdf(pdfBuffer);
  const props = result.properties;

  console.log('\n=== PARSER RESULTS ===');
  console.log('Total parsed:', props.length);
  console.log('Seed total:', seed.length);
  console.log('Seed unique codes:', seedByCode.size);

  // Check all 84 expected codes from PDF
  const allPdfCodes = [
    'RQB0777','RQB0701','RQB0727','RQB0659','RQB0739','RQB0806','RQB0767','RQB0740',
    'RQB0609','RQB0716','RQB0737','RQB0782','RQB0656','RQB0644','RQB0702','RQB0763',
    'RQB0630','RQB0662','RQB0708','RQB0752','RQB0800','RQB0786','RQB0665','RQB0810',
    'RQB0755','RQB0723','RQB0706','RQB0783','RQB0652','RQB0804','RQB0736','RQB0757',
    'RQB0761','RQB0748','RQB0674','RQB0802','RQB0803','RQB0697','RQB0745','RQB0799',
    'RQB0801','RQB0798','RQB0490','RQB0705','RQB0787','RQB0749','RQB0766','RQB0738',
    'RQB0793','RQB0715','RQB0639','RQB0767','RQB0624','RQB0627','RQB0719','RQB0746',
    'RQB0722','RQB0735','RQB0794','RQB0795','RQB0710','RQB0709','RQB0703','RQB0707',
    'RQB0714','RQB0734','RQB0785','RQB0796','RQB0790','RQB0770','RQB0758','RQB0778',
    'RQB0756','RQB0595','RQB0753','RQB0784','RQB0658','RQB0649','RQB0726','RQB0675',
    'RQB0721','RQB0788','RQB0780','RQB0676'
  ];

  // After dedup, we should have 84 unique codes
  const uniquePdfCodes = [...new Set(allPdfCodes)];
  console.log('\nExpected unique codes in PDF:', uniquePdfCodes.length);

  const parsedCodes = new Set(props.map(p => p.code));
  console.log('Parsed unique codes:', parsedCodes.size);

  // Missing from parser (in PDF but not parsed)
  const missingFromParser = uniquePdfCodes.filter(c => !parsedCodes.has(c));
  if (missingFromParser.length > 0) {
    console.log('\nMISSING from parser:', missingFromParser.join(', '));
  }

  // Extra in parser (parsed but not in PDF)
  const extraInParser = [...parsedCodes].filter(c => !uniquePdfCodes.includes(c));
  if (extraInParser.length > 0) {
    console.log('\nEXTRA in parser:', extraInParser.join(', '));
  }

  // Compare parsed vs seed
  let pass = 0, fail = 0, warn = 0;
  const issues: string[] = [];

  for (const prop of props) {
    const seedProp = seedByCode.get(prop.code);

    if (!seedProp) {
      // Not in seed data — parser found it but seed doesn't have it
      warn++;
      issues.push(`WARN ${prop.code} (item ~${prop.sortOrder + 1}): not in seed data | name="${prop.name}" region="${prop.region}" price=${prop.price}`);
      continue;
    }

    const codeIssues: string[] = [];

    // Compare key fields
    if (prop.name && seedProp.name && prop.name !== seedProp.name &&
        !prop.name.includes(seedProp.name) && !seedProp.name.includes(prop.name)) {
      codeIssues.push(`name: parsed="${prop.name}" seed="${seedProp.name}"`);
    }
    if (prop.region && seedProp.region && prop.region !== seedProp.region) {
      codeIssues.push(`region: parsed="${prop.region}" seed="${seedProp.region}"`);
    }
    if (prop.price !== null && seedProp.price !== null && prop.price !== seedProp.price) {
      // Only flag if difference > 1% (price updates between PDF versions)
      const diff = Math.abs(prop.price - seedProp.price) / seedProp.price;
      if (diff > 0.01) {
        codeIssues.push(`price: parsed=${prop.price} seed=${seedProp.price} (diff ${(diff*100).toFixed(1)}%)`);
      }
    }
    if (prop.area !== null && seedProp.area !== null && Math.abs(prop.area - seedProp.area) > 0.5) {
      codeIssues.push(`area: parsed=${prop.area} seed=${seedProp.area}`);
    }
    if (prop.category && seedProp.category && prop.category !== seedProp.category) {
      codeIssues.push(`category: parsed="${prop.category}" seed="${seedProp.category}"`);
    }
    if (prop.typology && seedProp.typology && prop.typology !== seedProp.typology &&
        !prop.typology.includes(seedProp.typology) && !seedProp.typology.includes(prop.typology)) {
      codeIssues.push(`typology: parsed="${prop.typology}" seed="${seedProp.typology}"`);
    }

    if (codeIssues.length > 0) {
      fail++;
      issues.push(`FAIL ${prop.code} (item ~${prop.sortOrder + 1}): ${codeIssues.join(' | ')}`);
    } else {
      pass++;
    }
  }

  console.log('\n=== COMPARISON RESULTS ===');
  console.log(`PASS: ${pass} | FAIL: ${fail} | WARN: ${warn} | Total: ${props.length}`);

  if (issues.length > 0) {
    console.log('\n=== ISSUES ===');
    for (const issue of issues) {
      console.log(issue);
    }
  }

  // Region assignment summary
  const regionCounts = new Map<string, number>();
  for (const prop of props) {
    const r = prop.region || '(sem região)';
    regionCounts.set(r, (regionCounts.get(r) || 0) + 1);
  }
  console.log('\n=== REGION DISTRIBUTION ===');
  for (const [region, count] of [...regionCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${region}: ${count}`);
  }

  // Property list
  console.log('\n=== PARSED PROPERTIES ===');
  for (const prop of props) {
    console.log(`  ${String(prop.sortOrder + 1).padStart(2)} | ${prop.code} | ${prop.region.padEnd(18)} | ${(prop.name || '-').padEnd(30)} | ${(prop.typology || '-').padEnd(20)} | ${prop.area || '-'}m² | R$ ${prop.price || '-'}`);
  }

  if (fail > 0 || missingFromParser.length > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
