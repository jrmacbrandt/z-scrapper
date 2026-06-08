import axios from "axios";

async function test() {
    try {
        const res = await axios.post("http://localhost:3001/api/ig/leads/scrape-keyword", {
            keyword: "dentista mesquita"
        });
        console.log("Start response:", res.data);
        
        // poll status
        const poll = setInterval(async () => {
            const statusRes = await axios.get("http://localhost:3001/api/ig/status");
            console.log("Logs:", statusRes.data.log);
            if (!statusRes.data.running) {
                clearInterval(poll);
            }
        }, 2000);
    } catch (e) {
        console.error(e.message);
    }
}
test();
