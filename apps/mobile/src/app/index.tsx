import { serviceRequestStatusSchema } from "@despacho/shared";
import { StyleSheet, Text, View } from "react-native";

export default function Index() {
  return (
    <View style={styles.container}>
      <Text>Despacho</Text>
      <Text>{serviceRequestStatusSchema.options.length} status de pedido</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
