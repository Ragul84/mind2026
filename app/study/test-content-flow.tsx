// Test page to check exact content flow
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RealDatabaseContentService } from '@/utils/realDatabaseContentService';

export default function TestContentFlow() {
  const [content, setContent] = useState<any>({});
  
  useEffect(() => {
    checkContent();
  }, []);
  
  const checkContent = async () => {
    // 1. Homepage shows topics
    const topics = await RealDatabaseContentService.getAllTopicsWithSubtopics();
    const indianConst = topics.find(t => t.name === 'Indian Constitution');

    if (!indianConst) {
      return;
    }

    // Get subtopics
    // Get first lesson part
    const lessonParts = await RealDatabaseContentService.getLessonPartsForTopic('Indian Constitution');

    if (lessonParts && lessonParts.length > 0) {
      const firstPart = lessonParts[0];

      // 3. Reading Interface loads content
      const partWithPages = await RealDatabaseContentService.getLessonPartWithPages(firstPart.id);

      if (partWithPages && partWithPages.pages) {
        setContent({
          topic: indianConst.name,
          lessonPart: firstPart,
          pages: partWithPages.pages
        });
      }
    }
  };
  
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0F0F23' }}>
      <ScrollView style={{ padding: 20 }}>
        <Text style={{ color: 'white', fontSize: 24, marginBottom: 20 }}>
          Content Flow Test
        </Text>
        
        <Text style={{ color: 'white', fontSize: 18, marginBottom: 10 }}>
          Topic: {content.topic || 'Loading...'}
        </Text>
        
        {content.lessonPart && (
          <View style={{ marginTop: 20 }}>
            <Text style={{ color: '#3A8DFF', fontSize: 16, marginBottom: 10 }}>
              Lesson Part: {content.lessonPart.part_title}
            </Text>
            <Text style={{ color: '#AAB2BD', fontSize: 14 }}>
              {content.lessonPart.short_description}
            </Text>
            <Text style={{ color: '#4ADE80', fontSize: 14, marginTop: 10 }}>
              Pages: {content.pages?.length || 0}
            </Text>
          </View>
        )}
        
        <Text style={{ color: '#AAB2BD', fontSize: 12, marginTop: 30 }}>
          Check browser console for detailed flow
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}