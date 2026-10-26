package cli

import (
	"os"
	"strings"
	"testing"
	"time"
)

const embeddedHTMLFixture = `<!doctype html><html><body><h1>Prototype fixture</h1><script>parent.compromised=true</script></body></html>`

func TestLarkConnectArchivesHTMLWithoutTurningItIntoAnImage(t *testing.T) {
	t.Setenv("LARK_FIXTURE_SCENARIO", "embedded_html")
	h := newConnectorHarness(t, "https://team.feishu.cn/docx/DocToken123")
	cmd, output, dir := connectorProcess(t, h.server.URL)
	select {
	case bundle := <-h.uploads:
		if len(bundle.Manifest.Resources) != 1 || bundle.Manifest.Completeness != "complete" {
			t.Fatalf("HTML was not archived: %#v", bundle.Manifest)
		}
		r := bundle.Manifest.Resources[0]
		if r.Kind != "html" || r.Status != "saved" || string(bundle.Files[r.Filename]) != embeddedHTMLFixture {
			t.Fatal("HTML original bytes were discarded or changed")
		}
		reading := string(bundle.Files["document.md"])
		if !strings.Contains(reading, "prototype\\.html") || strings.Contains(reading, "<source") || strings.Contains(reading, "![资源") || strings.Contains(reading, "<script") {
			t.Fatal("HTML attachment was embedded as active HTML or an image")
		}
	case failure := <-h.failures:
		t.Fatalf("HTML import failed: %#v", failure)
	case <-time.After(larkProcessTimeout):
		cmd.Process.Signal(os.Interrupt)
		cmd.Wait()
		t.Fatal("HTML import timed out")
	}
	stopConnector(t, cmd, output, dir)
}
