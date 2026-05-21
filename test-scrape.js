import * as cheerio from 'cheerio';

async function testScrape() {
  const url = 'https://www.zapimoveis.com.br/venda/imoveis/rj+niteroi/';
  console.log('Fetching', url);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    console.log('Status:', res.status);
    const html = await res.text();
    const $ = cheerio.load(html);
    const nextData = $('#__NEXT_DATA__').html();
    if (nextData) {
      console.log('Found __NEXT_DATA__! Length:', nextData.length);
      const data = JSON.parse(nextData);
      const listings = data?.props?.pageProps?.initialResults?.results?.listings || [];
      console.log('Listings found:', listings.length);
    } else {
      console.log('__NEXT_DATA__ NOT FOUND. Cloudflare might have blocked it.');
      console.log(html.substring(0, 500));
    }
  } catch(e) {
    console.error(e);
  }
}
testScrape();
