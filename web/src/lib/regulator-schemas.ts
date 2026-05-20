export type RegulatorId = 'finra' | 'sec';

export interface ScopeLabels {
	'broker': string;
	'broker-abbr': string;
	'ia': string;
	'ia-abbr': string;
	'previous-broker': string;
	'previous-broker-abbr': string;
	'previous-ia': string;
	'previous-ia-abbr': string;
	'broker-ia': string;
}

export interface CrossSiteLabels {
	'barred': string;
	'suspended': string;
	'limited': string;
	'not-registered': string;
	'x-site-description': string;
	'x-site-destination': string;
	'x-site-link-a': string;
	'x-site-link-b': string;
	'x-site-link-short': string;
	'x-site-source': string;
	'x-site-tooltip': string;
}

export interface RegulatorSchema {
	'home': {
		title: string;
	};
	'scope': {
		firm: ScopeLabels;
		individual: ScopeLabels;
	};
	'sanctions': Record<string, string>;
	'search-filters': {
		'radius': string;
		'experience': string;
		'status': {
			active: string;
			previous: string;
			barred: string;
		};
		'employer-search-scope': {
			include: string;
		};
	};
	'search-results': CrossSiteLabels;
	'individual-details-page': CrossSiteLabels;
}

export const REGULATOR_SCHEMAS = {
	finra: {
		'home': {
			title: 'BrokerCheck - Find a broker, investment or financial advisor',
		},
		'scope': {
			firm: {
				'broker': 'Brokerage Firm',
				'broker-abbr': 'B',
				'ia': 'Investment Adviser Firm',
				'ia-abbr': 'IA',
				'previous-broker': 'Previously Registered Brokerage Firm',
				'previous-broker-abbr': 'PR',
				'previous-ia': 'Previously Registered Investment Adviser Firm',
				'previous-ia-abbr': 'PR',
				'broker-ia': 'Brokerage & IA',
			},
			individual: {
				'broker': 'Broker',
				'broker-abbr': 'B',
				'ia': 'Investment Adviser',
				'ia-abbr': 'IA',
				'previous-broker': 'Previously Registered Broker',
				'previous-broker-abbr': 'PR',
				'previous-ia': 'Previously Registered Investment Adviser',
				'previous-ia-abbr': 'PR',
				'broker-ia': 'Broker & IA',
			},
		},
		'sanctions': {
			FINRA_BAR_ALL_MESSAGE: 'FINRA has barred this individual from acting as a broker or otherwise associating with a broker-dealer firm.',
			FINRA_BAR_OTHERORREG_MESSAGE: 'FINRA has barred this individual from engaging in certain activities. Please see the detailed report for additional information.',
			FINRA_BAR_SUPERVISORY_MESSAGE: 'FINRA has barred this individual from engaging in supervisory activities. Please see the detailed report for additional information.',
			FINRA_BAR_PRINCIPAL_MESSAGE:
				'FINRA has barred this individual from engaging in principal & supervisory activities. Please see the detailed report for additional information.',
			FINRA_SUS_ALL_MESSAGE: 'FINRA has suspended this individual from acting as a broker. Please see the detailed report for more information',
			FINRA_SUS_OTHERORREG_MESSAGE: 'FINRA has suspended this individual from engaging in certain activities. Please see the detailed report for more information',
			FINRA_SUS_SUPERVISORY_MESSAGE: 'FINRA has suspended this individual from engaging in supervisory activities. Please see the detailed report for more information',
			FINRA_SUS_PRINCIPAL_MESSAGE: 'FINRA has suspended this individual from engaging in principal & supervisory activities. Please see the detailed report for more information',
			SEC_BAR_BD_ALL_MESSAGE: 'The SEC has barred this individual from acting as a broker or otherwise associating with firms that sell securities to the public.',
			SEC_BAR_IA_ALL_MESSAGE:
				'The SEC has barred this individual from acting as an investment adviser or otherwise associating with firms that provide investment advice to the public.',
			SEC_BAR_BDIA_ALL_MESSAGE:
				'The SEC has barred this individual from acting as a broker or investment adviser or otherwise associating with firms that sell securities or provide investment advice to the public.',
			SEC_BAR_OTHERTYPES_MESSAGE: 'The SEC has barred this individual from engaging in certain activities. Please see the detailed report for additional information.',
			SEC_BAR_SUPERVISORY_MESSAGE: 'The SEC has barred this individual from engaging in supervisory activities. Please see the detailed report for additional information.',
			SEC_BAR_PRINCIPAL_MESSAGE:
				'The SEC has barred this individual from engaging in principal or supervisory activities. Please see the detailed report for additional information.',
			SEC_BAR_NOTALL_MESSAGE: 'The SEC has barred this individual from engaging in certain activities. Please see the detailed report for additional information.',
			SEC_BAR_MUNCIPAL_ANY_MESSAGE: 'The SEC has barred this individual from engaging in certain activities. Please see the detailed report for additional information.',
			SEC_LIMITED_BD_ALL_MESSAGE: 'The SEC has limited this individual from acting as a broker or otherwise associating with firms that sell securities to the public.',
			SEC_LIMITED_IA_ALL_MESSAGE:
				'The SEC has limited this individual from acting as an investment adviser or otherwise associating with firms that provide investment advice to the public.',
			SEC_LIMITED_BDIA_ALL_MESSAGE:
				'The SEC has limited this individual from acting as a broker or investment adviser or otherwise associating with firms that sell securities or provide investment advice to the public.',
			SEC_LIMITED_OTHERTYPES_MESSAGE: 'The SEC has limited this individual from engaging in certain activities. Please see the detailed report for additional information.',
			SEC_LIMITED_SUPERVISORY_MESSAGE: 'The SEC has limited this individual from engaging in supervisory activities. Please see the detailed report for additional information.',
			SEC_LIMITED_PRINCIPAL_MESSAGE:
				'The SEC has limited this individual from engaging in principal or supervisory activities. Please see the detailed report for additional information.',
			SEC_LIMITED_NOTALL_MESSAGE: 'The SEC has limited this individual from engaging in certain activities. Please see the detailed report for additional information.',
			SEC_LIMITED_MUNCIPAL_ANY_MESSAGE: 'The SEC has limited this individual from engaging in certain activities. Please see the detailed report for additional information.',
			SEC_SUS_BD_ALL_MESSAGE: 'The SEC has suspended this individual from acting as a broker. Please see the detailed report for more information',
			SEC_SUS_IA_ALL_MESSAGE: 'The SEC has suspended this individual from acting as an investment adviser. Please see the detailed report for more information',
			SEC_SUS_BDIA_ALL_MESSAGE: 'The SEC has suspended this individual from acting as a broker and an investment adviser. Please see the detailed report for more information',
			SEC_SUS_OTHERTYPES_MESSAGE: 'The SEC has suspended this individual from engaging in certain acitivities. Please see the detailed report for more information',
			SEC_SUS_SUPERVISORY_MESSAGE: 'The SEC has suspended this individual from engaging in supervisory activities. Please see the detailed report for more information',
			SEC_SUS_PRINCIPAL_MESSAGE: 'The SEC has suspended this individual from engaging in principal & supervisory activities. Please see the detailed report for more information',
			SEC_SUS_NOTALL_MESSAGE: 'The SEC has suspended this individual from engaging in certain acitivities. Please see the detailed report for more information',
			SEC_SUS_MUNCIPAL_ANY_MESSAGE: 'The SEC has suspended this individual from engaging in certain acitivities. Please see the detailed report for more information',
		},
		'search-filters': {
			'radius': 'Radius (Miles)',
			'experience': 'Experience (Years)',
			'status': {
				active: 'Actively Registered',
				previous: 'Previously Registered',
				barred: 'Barred/Limited',
			},
			'employer-search-scope': {
				include: 'Include Previous Employers',
			},
		},
		'search-results': {
			'barred': 'BARRED',
			'suspended': 'SUSPENDED',
			'limited': 'ALERT',
			'not-registered': 'Currently Not Registered',
			'x-site-description': "Visit the SEC's Investment Adviser Public Disclosure website for more information on this individual.",
			'x-site-destination': 'SEC Site',
			'x-site-link-a': 'For Disclosures',
			'x-site-link-b': '(if any) and Years of Experience visit SEC',
			'x-site-link-short': 'Visit SEC',
			'x-site-source': 'BrokerCheck',
			'x-site-tooltip':
				'All individuals registered to sell securities or provide investment advice are required to disclose customer complaints and arbitrations, regulatory actions, employment terminations, bankruptcy filings and criminal or civil judicial proceedings.',
		},
		'individual-details-page': {
			'barred': 'BARRED',
			'suspended': 'SUSPENDED',
			'limited': 'ALERT',
			'not-registered': 'Currently Not Registered',
			'x-site-description': "Visit the SEC's Investment Adviser Public Disclosure website for more information on this individual.",
			'x-site-destination': 'SEC Site',
			'x-site-link-a': 'For Disclosures',
			'x-site-link-b': '(if any) and Years of Experience visit SEC',
			'x-site-link-short': 'Visit SEC',
			'x-site-source': 'BrokerCheck',
			'x-site-tooltip':
				'All individuals registered to sell securities or provide investment advice are required to disclose customer complaints and arbitrations, regulatory actions, employment terminations, bankruptcy filings and criminal or civil judicial proceedings.',
		},
	},
	sec: {
		'home': {
			title: 'IAPD - Investment Adviser Public Disclosure - Homepage',
		},
		'scope': {
			firm: {
				'broker': 'Brokerage Firm',
				'broker-abbr': 'B',
				'ia': 'Investment Adviser Firm',
				'ia-abbr': 'IA',
				'previous-broker': 'Previous Brokerage Firm',
				'previous-broker-abbr': 'B',
				'previous-ia': 'Previous Investment Adviser Firm',
				'previous-ia-abbr': 'IA',
				'broker-ia': 'Brokerage & IA',
			},
			individual: {
				'broker': 'Broker',
				'broker-abbr': 'B',
				'ia': 'Investment Adviser',
				'ia-abbr': 'IA',
				'previous-broker': 'Previous Broker',
				'previous-broker-abbr': 'B',
				'previous-ia': 'Previous Investment Adviser',
				'previous-ia-abbr': 'IA',
				'broker-ia': 'Broker & IA',
			},
		},
		'sanctions': {
			FINRA_BAR_ALL_MESSAGE: 'FINRA has barred this individual from acting as a broker or otherwise associating with a broker-dealer firm.',
			FINRA_BAR_OTHERORREG_MESSAGE: 'FINRA has barred this individual from engaging in certain activities. Please see the detailed report for additional information.',
			FINRA_BAR_SUPERVISORY_MESSAGE: 'FINRA has barred this individual from engaging in supervisory activities. Please see the detailed report for additional information.',
			FINRA_BAR_PRINCIPAL_MESSAGE:
				'FINRA has barred this individual from engaging in principal & supervisory activities. Please see the detailed report for additional information.',
			FINRA_SUS_ALL_MESSAGE: 'FINRA has suspended this individual from acting as a broker. Please see the detailed report for more information',
			FINRA_SUS_OTHERORREG_MESSAGE: 'FINRA has suspended this individual from engaging in certain activities. Please see the detailed report for more information',
			FINRA_SUS_SUPERVISORY_MESSAGE: 'FINRA has suspended this individual from engaging in supervisory activities. Please see the detailed report for more information',
			FINRA_SUS_PRINCIPAL_MESSAGE: 'FINRA has suspended this individual from engaging in principal & supervisory activities. Please see the detailed report for more information',
			SEC_BAR_BD_ALL_MESSAGE: 'The SEC has barred this individual from acting as a broker or otherwise associating with firms that sell securities to the public.',
			SEC_BAR_IA_ALL_MESSAGE:
				'The SEC has barred this individual from acting as an investment adviser or otherwise associating with firms that provide investment advice to the public.',
			SEC_BAR_BDIA_ALL_MESSAGE:
				'The SEC has barred this individual from acting as a broker or investment adviser or otherwise associating with firms that sell securities or provide investment advice to the public.',
			SEC_BAR_OTHERTYPES_MESSAGE: 'The SEC has barred this individual from engaging in certain activities. Please see the detailed report for additional information.',
			SEC_BAR_SUPERVISORY_MESSAGE: 'The SEC has barred this individual from engaging in supervisory activities. Please see the detailed report for additional information.',
			SEC_BAR_PRINCIPAL_MESSAGE:
				'The SEC has barred this individual from engaging in principal or supervisory activities. Please see the detailed report for additional information.',
			SEC_BAR_NOTALL_MESSAGE: 'The SEC has barred this individual from engaging in certain activities. Please see the detailed report for additional information.',
			SEC_BAR_MUNCIPAL_ANY_MESSAGE: 'The SEC has barred this individual from engaging in certain activities. Please see the detailed report for additional information.',
			SEC_LIMITED_BD_ALL_MESSAGE: 'The SEC has limited this individual from acting as a broker or otherwise associating with firms that sell securities to the public.',
			SEC_LIMITED_IA_ALL_MESSAGE:
				'The SEC has limited this individual from acting as an investment adviser or otherwise associating with firms that provide investment advice to the public.',
			SEC_LIMITED_BDIA_ALL_MESSAGE:
				'The SEC has limited this individual from acting as a broker or investment adviser or otherwise associating with firms that sell securities or provide investment advice to the public.',
			SEC_LIMITED_OTHERTYPES_MESSAGE: 'The SEC has limited this individual from engaging in certain activities. Please see the detailed report for additional information.',
			SEC_LIMITED_SUPERVISORY_MESSAGE: 'The SEC has limited this individual from engaging in supervisory activities. Please see the detailed report for additional information.',
			SEC_LIMITED_PRINCIPAL_MESSAGE:
				'The SEC has limited this individual from engaging in principal or supervisory activities. Please see the detailed report for additional information.',
			SEC_LIMITED_NOTALL_MESSAGE: 'The SEC has limited this individual from engaging in certain activities. Please see the detailed report for additional information.',
			SEC_LIMITED_MUNCIPAL_ANY_MESSAGE: 'The SEC has limited this individual from engaging in certain activities. Please see the detailed report for additional information.',
			SEC_SUS_BD_ALL_MESSAGE: 'The SEC has suspended this individual from acting as a broker. Please see the detailed report for more information',
			SEC_SUS_IA_ALL_MESSAGE: 'The SEC has suspended this individual from acting as an investment adviser. Please see the detailed report for more information',
			SEC_SUS_BDIA_ALL_MESSAGE: 'The SEC has suspended this individual from acting as a broker and an investment adviser. Please see the detailed report for more information',
			SEC_SUS_OTHERTYPES_MESSAGE: 'The SEC has suspended this individual from engaging in certain acitivities. Please see the detailed report for more information',
			SEC_SUS_SUPERVISORY_MESSAGE: 'The SEC has suspended this individual from engaging in supervisory activities. Please see the detailed report for more information',
			SEC_SUS_PRINCIPAL_MESSAGE: 'The SEC has suspended this individual from engaging in principal & supervisory activities. Please see the detailed report for more information',
			SEC_SUS_NOTALL_MESSAGE: 'The SEC has suspended this individual from engaging in certain acitivities. Please see the detailed report for more information',
			SEC_SUS_MUNCIPAL_ANY_MESSAGE: 'The SEC has suspended this individual from engaging in certain acitivities. Please see the detailed report for more information',
		},
		'search-filters': {
			'radius': 'Radius (Miles)',
			'experience': 'Experience (Years)',
			'status': {
				active: 'Actively Registered',
				previous: 'Previously Registered',
				barred: 'Barred/Limited by FINRA or the SEC',
			},
			'employer-search-scope': {
				include: 'Include Previous Employers',
			},
		},
		'search-results': {
			'barred': 'BARRED',
			'suspended': 'SUSPENDED',
			'limited': 'ALERT',
			'not-registered': 'Currently Not Registered',
			'x-site-description': 'Visit the BrokerCheck website for more information on this individual.',
			'x-site-destination': 'BrokerCheck',
			'x-site-link-a': 'For Disclosures',
			'x-site-link-b': '(if any) and Years of Experience visit BrokerCheck',
			'x-site-link-short': 'Visit BrokerCheck',
			'x-site-source': 'IAPD',
			'x-site-tooltip':
				'All individuals registered to sell securities or provide investment advice are required to disclose customer complaints and arbitrations, regulatory actions, employment terminations, bankruptcy filings and criminal or civil judicial proceedings.',
		},
		'individual-details-page': {
			'barred': 'BARRED BY FINRA OR THE SEC',
			'limited': 'ALERT',
			'suspended': 'SUSPENDED',
			'not-registered': 'Currently Not Registered',
			'x-site-description': 'Visit the BrokerCheck website for more information on this individual.',
			'x-site-destination': 'BrokerCheck',
			'x-site-link-a': 'For Disclosures',
			'x-site-link-b': '(if any) and Years of Experience visit BrokerCheck',
			'x-site-link-short': 'Visit BrokerCheck',
			'x-site-source': 'IAPD',
			'x-site-tooltip':
				'All individuals registered to sell securities or provide investment advice are required to disclose customer complaints and arbitrations, regulatory actions, employment terminations, bankruptcy filings and criminal or civil judicial proceedings.',
		},
	},
} satisfies Record<RegulatorId, RegulatorSchema>;

export const DEFAULT_REGULATOR_ID: RegulatorId = 'finra';
export const DEFAULT_REGULATOR_SCHEMA = REGULATOR_SCHEMAS[DEFAULT_REGULATOR_ID];

export function getRegulatorSchema(regulatorId: RegulatorId): RegulatorSchema {
	return REGULATOR_SCHEMAS[regulatorId];
}
