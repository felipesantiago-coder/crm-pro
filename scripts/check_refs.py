import re

with open('src/app/api/tracking/report/route.ts', 'r') as f:
    lines = f.readlines()

names = ['kpis','bouncedVisitors','chartData','funnelData','byCampaign','bySource','byContent','byMedium','byTerm','byEventType','topPages','topCountries','topCities','deviceBreakdown','hourlyData','recentLeads','allLeadsWithJourney','referrerBreakdown','metaPixelLeads','metaCrmLeads','metaMatched','scrollDepthData','formInteractionData','exitIntentCount','topEntryPages','avgSessionDuration','returningVisitors','engagementByDayOfWeek','whatsappClicks','webVitalsData','engagedTimeData','jsErrorsData','sectionViewsData','ctaClicksData','formFunnelData','visitorContextData','contentEngagementData']

for i, line in enumerate(lines, 1):
    if i < 920:
        continue
    for name in names:
        if re.search(r'\b' + name + r'(?![a-zA-Z0-9])', line) and 'unbig(' not in line and '2' not in re.search(r'\b' + name + r'(?![a-zA-Z0-9])', line).group():
            print(f'L{i}: {name} -> {line.rstrip()[:120]}')