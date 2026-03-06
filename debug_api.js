async function test() {
    try {
        const res = await fetch('http://localhost:3001/api/assets/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png', filename: 'test_debug.png' })
        });
        console.log('Status:', res.status);
        const text = await res.text();
        console.log('Body:', text.substring(0, 200));
    } catch (e) {
        console.error('Error:', e.message);
    }
}
test();
