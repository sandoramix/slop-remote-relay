import { Box } from '@/components/ui/box';
import { Button, ButtonText } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';

export default function Index() {
  return (
    <Box className="flex-1 items-center justify-center gap-4 bg-background">
      <Heading className="text-foreground">Relay</Heading>
      <Button><ButtonText>Schermo intero</ButtonText></Button>
    </Box>
  );
}
