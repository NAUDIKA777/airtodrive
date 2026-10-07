import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import type { ComponentProps } from "react";

// Thin wrapper so the whole app imports icons from one place.
export type IconName = ComponentProps<typeof MaterialDesignIcons>["name"];

export function Icon(props: ComponentProps<typeof MaterialDesignIcons>) {
  return <MaterialDesignIcons {...props} />;
}
