import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, Text, View } from 'react-native';

/**
 * Scrollable screen for forms and detail pages inside a Stack.
 * - Starts content below the (translucent, on iOS 26) navigation header.
 * - Keeps the focused field above the keyboard (iOS insets; Android resizes the window).
 * - Drag down or tap empty space to dismiss the keyboard, or use the "Done" bar on top of it.
 */
export function FormScreen({ children, className }: { children: ReactNode; className?: string }) {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) =>
      // Android resizes the window for the keyboard, so the bar just sits at the bottom.
      setKeyboardHeight(ios ? e.endCoordinates.height : 1),
    );
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const keyboardOpen = keyboardHeight > 0 && Platform.OS !== 'web';

  return (
    <View className="flex-1 bg-slate-50 dark:bg-slate-950">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName={className ?? 'gap-4 p-4 pb-24'}
      >
        {children}
      </ScrollView>
      {keyboardOpen ? (
        <View
          style={{ position: 'absolute', left: 0, right: 0, bottom: Platform.OS === 'ios' ? keyboardHeight : 0 }}
          className="flex-row justify-end border-t border-slate-200 bg-slate-100 px-4 py-2 dark:border-slate-700 dark:bg-slate-800"
        >
          <Pressable accessibilityRole="button" accessibilityLabel="Hide keyboard" onPress={() => Keyboard.dismiss()} hitSlop={12}>
            <Text className="text-base font-semibold text-brand dark:text-blue-300">Done</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
