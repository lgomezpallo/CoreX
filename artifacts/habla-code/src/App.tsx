import ConversationalBuilder from "@/components/conversational-builder";
import { AuthGate } from "@/components/auth-gate";

function App() {
  return (
    <AuthGate>
      <ConversationalBuilder />
    </AuthGate>
  );
}

export default App;