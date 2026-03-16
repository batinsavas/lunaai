const OPENROUTER_API_KEY = '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';

async function test(model) {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "model": model,
        "messages": [{ role: 'user', content: 'Merhaba' }]
      })
    });
    const data = await res.json();
    console.log(model, ":", data.choices ? "SUCCESS" : data.error?.message);
  } catch(e) {
    console.error("Fetch err:", e);
  }
}
async function run() {
  await test("google/gemini-2.5-flash:free");
  await test("meta-llama/llama-3.2-90b-vision-instruct:free");
  await test("qwen/qwen-2-vl-72b-instruct:free");
  await test("qwen/qwen2.5-vl-72b-instruct:free");
}
run();
